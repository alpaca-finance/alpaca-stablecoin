// SPDX-License-Identifier: AGPL-3.0-or-later

// Copyright (C) 2018-2020 Maker Ecosystem Growth Holdings, INC.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "../interfaces/IBookKeeper.sol";
import "../interfaces/IWBNB.sol";
import "../interfaces/IToken.sol";
import "../interfaces/IManager.sol";
import "../interfaces/IAdapter.sol";
import "../interfaces/IFarmableTokenAdapter.sol";
import "../interfaces/IStablecoinAdapter.sol";
import "../interfaces/IStabilityFeeCollector.sol";
import "../interfaces/IProxyRegistry.sol";
import "../interfaces/IProxy.sol";

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// WARNING: These functions meant to be used as a a library for a DSProxy. Some are unsafe if you call them directly.
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

contract Common {
  uint256 constant RAY = 10**27;

  // Internal functions

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x, "mul-overflow");
  }

  // Public functions

  function stablecoinAdapter_deposit(
    address apt,
    address positionAddress,
    uint256 wad
  ) public {
    // Gets Alpaca Stablecoin from the user's wallet
    IStablecoinAdapter(apt).stablecoin().transferFrom(msg.sender, address(this), wad);
    // Approves adapter to take the Alpaca Stablecoin amount
    IStablecoinAdapter(apt).stablecoin().approve(apt, wad);
    // Deposits Alpaca Stablecoin into the bookKeeper
    IStablecoinAdapter(apt).deposit(positionAddress, wad, abi.encode(0));
  }
}

contract AlpacaStablecoinProxyActions is OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable, Common {
  // --- Init ---
  function initialize() external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
  }

  // Internal functions

  function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x - y) <= x, "sub-overflow");
  }

  function toInt(uint256 x) internal pure returns (int256 y) {
    y = int256(x);
    require(y >= 0, "int-overflow");
  }

  function toRad(uint256 wad) internal pure returns (uint256 rad) {
    rad = mul(wad, 10**27);
  }

  function convertTo18(address tokenAdapter, uint256 amt) internal returns (uint256 wad) {
    // For those collaterals that have less than 18 decimals precision we need to do the conversion before passing to adjustPosition function
    // Adapters will automatically handle the difference of precision
    wad = mul(amt, 10**(18 - IAdapter(tokenAdapter).decimals()));
  }

  function _getDrawDebtShare(
    address bookKeeper,
    address stabilityFeeCollector,
    address positionAddress,
    bytes32 collateralPoolId,
    uint256 wad
  ) internal returns (int256 resultDebtShare) {
    // Updates stability fee rate
    uint256 debtAccumulatedRate = IStabilityFeeCollector(stabilityFeeCollector).collect(collateralPoolId);

    // Gets Alpaca Stablecoin balance of the positionAddress in the bookKeeper
    uint256 stablecoin = IBookKeeper(bookKeeper).stablecoin(positionAddress);

    // If there was already enough Alpaca Stablecoin in the bookKeeper balance, just exits it without adding more debt
    if (stablecoin < mul(wad, RAY)) {
      // Calculates the needed resultDebtShare so together with the existing stablecoin in the bookKeeper is enough to exit wad amount of Alpaca Stablecoin tokens
      resultDebtShare = toInt(sub(mul(wad, RAY), stablecoin) / debtAccumulatedRate);
      // This is neeeded due lack of precision. It might need to sum an extra resultDebtShare wei (for the given Alpaca Stablecoin wad amount)
      resultDebtShare = mul(uint256(resultDebtShare), debtAccumulatedRate) < mul(wad, RAY)
        ? resultDebtShare + 1
        : resultDebtShare;
    }
  }

  function _getWipeDebtShare(
    address bookKeeper,
    uint256 stablecoinBalance,
    address positionAddress,
    bytes32 collateralPoolId
  ) internal view returns (int256 resultDebtShare) {
    // Gets actual rate from the bookKeeper
    (, uint256 debtAccumulatedRate, , , ) = IBookKeeper(bookKeeper).collateralPools(collateralPoolId);
    // Gets actual debtShare value of the positionAddress
    (, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPoolId, positionAddress);

    // Uses the whole stablecoin balance in the bookKeeper to reduce the debt
    resultDebtShare = toInt(stablecoinBalance / debtAccumulatedRate);
    // Checks the calculated resultDebtShare is not higher than positionAddress.art (total debt), otherwise uses its value
    resultDebtShare = uint256(resultDebtShare) <= debtShare ? -resultDebtShare : -toInt(debtShare);
  }

  function _getWipeAllWad(
    address bookKeeper,
    address usr,
    address positionAddress,
    bytes32 collateralPoolId
  ) internal view returns (uint256 wad) {
    // Gets actual rate from the bookKeeper
    (, uint256 rate, , , ) = IBookKeeper(bookKeeper).collateralPools(collateralPoolId);
    // Gets actual debtShare value of the positionAddress
    (, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPoolId, positionAddress);
    // Gets actual stablecoin amount in the positionAddress
    uint256 stablecoin = IBookKeeper(bookKeeper).stablecoin(usr);

    uint256 rad = sub(mul(debtShare, rate), stablecoin);
    wad = rad / RAY;

    // If the rad precision has some dust, it will need to request for 1 extra wad wei
    wad = mul(wad, RAY) < rad ? wad + 1 : wad;
  }

  // Public functions

  function transfer(
    address collateralToken,
    address dst,
    uint256 amt
  ) public {
    IToken(collateralToken).transfer(dst, amt);
  }

  function bnbAdapter_deposit(address apt, address positionAddress) public payable {
    // Wraps BNB in WBNB
    IWBNB(address(IAdapter(apt).collateralToken())).deposit.value(msg.value)();
    // Approves adapter to take the WBNB amount
    IAdapter(apt).collateralToken().approve(address(apt), msg.value);
    // Deposits WBNB collateral into the bookKeeper
    IAdapter(apt).deposit(positionAddress, msg.value, abi.encode(0));
  }

  function tokenAdapter_deposit(
    address apt,
    address positionAddress,
    uint256 amt,
    bool transferFrom
  ) public {
    // Only executes for tokens that have approval/transferFrom implementation
    if (transferFrom) {
      // Gets token from the user's wallet
      IAdapter(apt).collateralToken().transferFrom(msg.sender, address(this), amt);
      // Approves adapter to take the token amount
      IAdapter(apt).collateralToken().approve(apt, amt);
    }
    // Deposits token collateral into the bookKeeper
    IAdapter(apt).deposit(positionAddress, amt, abi.encode(msg.sender));
  }

  function hope(address obj, address usr) public {
    IBookKeeper(obj).hope(usr);
  }

  function nope(address obj, address usr) public {
    IBookKeeper(obj).nope(usr);
  }

  function open(
    address manager,
    bytes32 collateralPoolId,
    address usr
  ) public returns (uint256 cdp) {
    cdp = IManager(manager).open(collateralPoolId, usr);
  }

  function give(
    address manager,
    uint256 cdp,
    address usr
  ) public {
    IManager(manager).give(cdp, usr);
  }

  function giveToProxy(
    address proxyRegistry,
    address manager,
    uint256 cdp,
    address dst
  ) public {
    // Gets actual proxy address
    address proxy = IProxyRegistry(proxyRegistry).proxies(dst);
    // Checks if the proxy address already existed and dst address is still the owner
    if (proxy == address(0) || IProxy(proxy).owner() != dst) {
      uint256 csize;
      assembly {
        csize := extcodesize(dst)
      }
      // We want to avoid creating a proxy for a contract address that might not be able to handle proxies, then losing the CDP
      require(csize == 0, "Dst-is-a-contract");
      // Creates the proxy for the dst address
      proxy = IProxyRegistry(proxyRegistry).build(dst);
    }
    // Transfers CDP to the dst proxy
    give(manager, cdp, proxy);
  }

  function cdpAllow(
    address manager,
    uint256 cdp,
    address usr,
    uint256 ok
  ) public {
    IManager(manager).cdpAllow(cdp, usr, ok);
  }

  function positionAllow(
    address manager,
    address usr,
    uint256 ok
  ) public {
    IManager(manager).positionAllow(usr, ok);
  }

  function moveCollateral(
    address manager,
    uint256 cdp,
    address dst,
    uint256 wad
  ) public {
    IManager(manager).moveCollateral(cdp, dst, wad);
  }

  function moveStablecoin(
    address manager,
    uint256 cdp,
    address dst,
    uint256 rad
  ) public {
    IManager(manager).moveStablecoin(cdp, dst, rad);
  }

  function adjustPosition(
    address manager,
    uint256 cdp,
    int256 dink,
    int256 dart
  ) public {
    IManager(manager).adjustPosition(cdp, dink, dart);
  }

  function quit(
    address manager,
    uint256 cdp,
    address dst
  ) public {
    IManager(manager).quit(cdp, dst);
  }

  function enter(
    address manager,
    address src,
    uint256 cdp
  ) public {
    IManager(manager).enter(src, cdp);
  }

  function shift(
    address manager,
    uint256 cdpSrc,
    uint256 cdpOrg
  ) public {
    IManager(manager).shift(cdpSrc, cdpOrg);
  }

  function lockBNB(
    address manager,
    address bnbAdapter,
    uint256 cdp
  ) public payable {
    // Receives BNB amount, converts it to WBNB and joins it into the bookKeeper
    bnbAdapter_deposit(bnbAdapter, address(this));
    // Locks WBNB amount into the CDP
    IBookKeeper(IManager(manager).bookKeeper()).adjustPosition(
      IManager(manager).collateralPools(cdp),
      IManager(manager).positions(cdp),
      address(this),
      address(this),
      toInt(msg.value),
      0
    );
  }

  function safeLockBNB(
    address manager,
    address bnbAdapter,
    uint256 cdp,
    address owner
  ) public payable {
    require(IManager(manager).owns(cdp) == owner, "owner-missmatch");
    lockBNB(manager, bnbAdapter, cdp);
  }

  function lockToken(
    address manager,
    address tokenAdapter,
    uint256 cdp,
    uint256 amt,
    bool transferFrom
  ) public {
    address positionAddress = IManager(manager).positions(cdp);
    // Takes token amount from user's wallet and joins into the bookKeeper
    tokenAdapter_deposit(tokenAdapter, address(this), amt, transferFrom);
    // Locks token amount into the CDP
    IBookKeeper(IManager(manager).bookKeeper()).adjustPosition(
      IManager(manager).collateralPools(cdp),
      IManager(manager).positions(cdp),
      address(this),
      address(this),
      toInt(convertTo18(tokenAdapter, amt)),
      0
    );
    if(IAdapter(tokenAdapter).isFarmable()) IFarmableTokenAdapter(tokenAdapter).moveRewards(positionAddress, address(this), amt);
  }

  function safeLockToken(
    address manager,
    address tokenAdapter,
    uint256 cdp,
    uint256 amt,
    bool transferFrom,
    address owner
  ) public {
    require(IManager(manager).owns(cdp) == owner, "owner-missmatch");
    lockToken(manager, tokenAdapter, cdp, amt, transferFrom);
  }

  function freeBNB(
    address manager,
    address bnbAdapter,
    uint256 cdp,
    uint256 wad
  ) public {
    // Unlocks WBNB amount from the CDP
    adjustPosition(manager, cdp, -toInt(wad), 0);
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), wad);
    // Withdraws WBNB amount to proxy address as a token
    IAdapter(bnbAdapter).withdraw(address(this), wad, abi.encode(0));
    // Converts WBNB to BNB
    IWBNB(address(IAdapter(bnbAdapter).collateralToken())).withdraw(wad);
    // Sends BNB back to the user's wallet
    msg.sender.transfer(wad);
  }

  function freeToken(
    address manager,
    address tokenAdapter,
    uint256 cdp,
    uint256 amt,
    bytes calldata data
  ) public {
    address positionAddress = IManager(manager).positions(cdp);
    uint256 wad = convertTo18(tokenAdapter, amt);
    // Unlocks token amount from the CDP
    adjustPosition(manager, cdp, -toInt(wad), 0);
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), wad);
    // Withdraws token amount to the user's wallet as a token
    if(IAdapter(tokenAdapter).isFarmable()) IFarmableTokenAdapter(tokenAdapter).moveRewards(positionAddress, address(this), wad);
    IAdapter(tokenAdapter).withdraw(msg.sender, amt, data);
  }

  function exitBNB(
    address manager,
    address bnbAdapter,
    uint256 cdp,
    uint256 wad
  ) public {
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), wad);

    // Withdraws WBNB amount to proxy address as a token
    IAdapter(bnbAdapter).withdraw(address(this), wad, abi.encode(0));
    // Converts WBNB to BNB
    IWBNB(address(IAdapter(bnbAdapter).collateralToken())).withdraw(wad);
    // Sends BNB back to the user's wallet
    msg.sender.transfer(wad);
  }

  function exitToken(
    address manager,
    address tokenAdapter,
    uint256 cdp,
    uint256 amt
  ) public {
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), convertTo18(tokenAdapter, amt));

    // Withdraws token amount to the user's wallet as a token
    IAdapter(tokenAdapter).withdraw(msg.sender, amt, abi.encode(0));
  }

  function draw(
    address manager,
    address stabilityFeeCollector,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 wad
  ) public {
    address positionAddress = IManager(manager).positions(cdp);
    address bookKeeper = IManager(manager).bookKeeper();
    bytes32 collateralPoolId = IManager(manager).collateralPools(cdp);
    // Generates debt in the CDP
    adjustPosition(
      manager,
      cdp,
      0,
      _getDrawDebtShare(bookKeeper, stabilityFeeCollector, positionAddress, collateralPoolId, wad)
    );
    // Moves the Alpaca Stablecoin amount (balance in the bookKeeper in rad) to proxy's address
    moveStablecoin(manager, cdp, address(this), toRad(wad));
    // Allows adapter to access to proxy's Alpaca Stablecoin balance in the bookKeeper
    if (IBookKeeper(bookKeeper).can(address(this), address(stablecoinAdapter)) == 0) {
      IBookKeeper(bookKeeper).hope(stablecoinAdapter);
    }
    // Withdraws Alpaca Stablecoin to the user's wallet as a token
    IStablecoinAdapter(stablecoinAdapter).withdraw(msg.sender, wad, abi.encode(0));
  }

  function wipe(
    address manager,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 wad
  ) public {
    address bookKeeper = IManager(manager).bookKeeper();
    address positionAddress = IManager(manager).positions(cdp);
    bytes32 collateralPoolId = IManager(manager).collateralPools(cdp);

    address own = IManager(manager).owns(cdp);
    if (own == address(this) || IManager(manager).cdpCan(own, cdp, address(this)) == 1) {
      // Deposits Alpaca Stablecoin amount into the bookKeeper
      stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, wad);
      // Paybacks debt to the CDP
      adjustPosition(
        manager,
        cdp,
        0,
        _getWipeDebtShare(
          bookKeeper,
          IBookKeeper(bookKeeper).stablecoin(positionAddress),
          positionAddress,
          collateralPoolId
        )
      );
    } else {
      // Deposits Alpaca Stablecoin amount into the bookKeeper
      stablecoinAdapter_deposit(stablecoinAdapter, address(this), wad);
      // Paybacks debt to the CDP
      IBookKeeper(bookKeeper).adjustPosition(
        collateralPoolId,
        positionAddress,
        address(this),
        address(this),
        0,
        _getWipeDebtShare(bookKeeper, wad * RAY, positionAddress, collateralPoolId)
      );
    }
  }

  function safeWipe(
    address manager,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 wad,
    address owner
  ) public {
    require(IManager(manager).owns(cdp) == owner, "owner-missmatch");
    wipe(manager, stablecoinAdapter, cdp, wad);
  }

  function wipeAll(
    address manager,
    address stablecoinAdapter,
    uint256 cdp
  ) public {
    address bookKeeper = IManager(manager).bookKeeper();
    address positionAddress = IManager(manager).positions(cdp);
    bytes32 collateralPoolId = IManager(manager).collateralPools(cdp);
    (, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPoolId, positionAddress);

    address own = IManager(manager).owns(cdp);
    if (own == address(this) || IManager(manager).cdpCan(own, cdp, address(this)) == 1) {
      // Deposits Alpaca Stablecoin amount into the bookKeeper
      stablecoinAdapter_deposit(
        stablecoinAdapter,
        positionAddress,
        _getWipeAllWad(bookKeeper, positionAddress, positionAddress, collateralPoolId)
      );
      // Paybacks debt to the CDP
      adjustPosition(manager, cdp, 0, -int256(debtShare));
    } else {
      // Deposits Alpaca Stablecoin amount into the bookKeeper
      stablecoinAdapter_deposit(
        stablecoinAdapter,
        address(this),
        _getWipeAllWad(bookKeeper, address(this), positionAddress, collateralPoolId)
      );
      // Paybacks debt to the CDP
      IBookKeeper(bookKeeper).adjustPosition(
        collateralPoolId,
        positionAddress,
        address(this),
        address(this),
        0,
        -int256(debtShare)
      );
    }
  }

  function safeWipeAll(
    address manager,
    address stablecoinAdapter,
    uint256 cdp,
    address owner
  ) public {
    require(IManager(manager).owns(cdp) == owner, "owner-missmatch");
    wipeAll(manager, stablecoinAdapter, cdp);
  }

  function lockBNBAndDraw(
    address manager,
    address stabilityFeeCollector,
    address bnbAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 wadD
  ) public payable {
    address positionAddress = IManager(manager).positions(cdp);
    address bookKeeper = IManager(manager).bookKeeper();
    bytes32 collateralPoolId = IManager(manager).collateralPools(cdp);
    // Receives BNB amount, converts it to WBNB and joins it into the bookKeeper
    bnbAdapter_deposit(bnbAdapter, positionAddress);
    // Locks WBNB amount into the CDP and generates debt
    adjustPosition(
      manager,
      cdp,
      toInt(msg.value),
      _getDrawDebtShare(bookKeeper, stabilityFeeCollector, positionAddress, collateralPoolId, wadD)
    );
    // Moves the Alpaca Stablecoin amount (balance in the bookKeeper in rad) to proxy's address
    moveStablecoin(manager, cdp, address(this), toRad(wadD));
    // Allows adapter to access to proxy's Alpaca Stablecoin balance in the bookKeeper
    if (IBookKeeper(bookKeeper).can(address(this), address(stablecoinAdapter)) == 0) {
      IBookKeeper(bookKeeper).hope(stablecoinAdapter);
    }
    // Withdraws Alpaca Stablecoin to the user's wallet as a token
    IStablecoinAdapter(stablecoinAdapter).withdraw(msg.sender, wadD, abi.encode(0));
  }

  function openLockBNBAndDraw(
    address manager,
    address stabilityFeeCollector,
    address bnbAdapter,
    address stablecoinAdapter,
    bytes32 collateralPoolId,
    uint256 wadD
  ) public payable returns (uint256 cdp) {
    cdp = open(manager, collateralPoolId, address(this));
    lockBNBAndDraw(manager, stabilityFeeCollector, bnbAdapter, stablecoinAdapter, cdp, wadD);
  }

  function lockTokenAndDraw(
    address manager,
    address stabilityFeeCollector,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 amtC,
    uint256 wadD,
    bool transferFrom
  ) public {
    address positionAddress = IManager(manager).positions(cdp);
    address bookKeeper = IManager(manager).bookKeeper();
    bytes32 collateralPoolId = IManager(manager).collateralPools(cdp);
    // Takes token amount from user's wallet and joins into the bookKeeper
    tokenAdapter_deposit(tokenAdapter, positionAddress, amtC, transferFrom);
    // Locks token amount into the CDP and generates debt
    adjustPosition(
      manager,
      cdp,
      toInt(convertTo18(tokenAdapter, amtC)),
      _getDrawDebtShare(bookKeeper, stabilityFeeCollector, positionAddress, collateralPoolId, wadD)
    );
    // Moves the Alpaca Stablecoin amount (balance in the bookKeeper in rad) to proxy's address
    moveStablecoin(manager, cdp, address(this), toRad(wadD));
    // Allows adapter to access to proxy's Alpaca Stablecoin balance in the bookKeeper
    if (IBookKeeper(bookKeeper).can(address(this), address(stablecoinAdapter)) == 0) {
      IBookKeeper(bookKeeper).hope(stablecoinAdapter);
    }
    // Withdraws Alpaca Stablecoin to the user's wallet as a token
    IStablecoinAdapter(stablecoinAdapter).withdraw(msg.sender, wadD, abi.encode(0));
  }

  function openLockTokenAndDraw(
    address manager,
    address stabilityFeeCollector,
    address tokenAdapter,
    address stablecoinAdapter,
    bytes32 collateralPoolId,
    uint256 amtC,
    uint256 wadD,
    bool transferFrom
  ) public returns (uint256 cdp) {
    cdp = open(manager, collateralPoolId, address(this));
    lockTokenAndDraw(manager, stabilityFeeCollector, tokenAdapter, stablecoinAdapter, cdp, amtC, wadD, transferFrom);
  }

  function wipeAndFreeBNB(
    address manager,
    address bnbAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 wadC,
    uint256 wadD
  ) public {
    address positionAddress = IManager(manager).positions(cdp);
    // Deposits Alpaca Stablecoin amount into the bookKeeper
    stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, wadD);
    // Paybacks debt to the CDP and unlocks WBNB amount from it
    adjustPosition(
      manager,
      cdp,
      -toInt(wadC),
      _getWipeDebtShare(
        IManager(manager).bookKeeper(),
        IBookKeeper(IManager(manager).bookKeeper()).stablecoin(positionAddress),
        positionAddress,
        IManager(manager).collateralPools(cdp)
      )
    );
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), wadC);
    // Withdraws WBNB amount to proxy address as a token
    IAdapter(bnbAdapter).withdraw(address(this), wadC, abi.encode(0));
    // Converts WBNB to BNB
    IWBNB(address(IAdapter(bnbAdapter).collateralToken())).withdraw(wadC);
    // Sends BNB back to the user's wallet
    msg.sender.transfer(wadC);
  }

  function wipeAllAndFreeBNB(
    address manager,
    address bnbAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 wadC
  ) public {
    address bookKeeper = IManager(manager).bookKeeper();
    address positionAddress = IManager(manager).positions(cdp);
    bytes32 collateralPoolId = IManager(manager).collateralPools(cdp);
    (, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPoolId, positionAddress);

    // Deposits Alpaca Stablecoin amount into the bookKeeper
    stablecoinAdapter_deposit(
      stablecoinAdapter,
      positionAddress,
      _getWipeAllWad(bookKeeper, positionAddress, positionAddress, collateralPoolId)
    );
    // Paybacks debt to the CDP and unlocks WBNB amount from it
    adjustPosition(manager, cdp, -toInt(wadC), -int256(debtShare));
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), wadC);
    // Withdraws WBNB amount to proxy address as a token
    IAdapter(bnbAdapter).withdraw(address(this), wadC, abi.encode(0));
    // Converts WBNB to BNB
    IWBNB(address(IAdapter(bnbAdapter).collateralToken())).withdraw(wadC);
    // Sends BNB back to the user's wallet
    msg.sender.transfer(wadC);
  }

  function wipeAndFreeToken(
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 amtC,
    uint256 wadD
  ) public {
    address positionAddress = IManager(manager).positions(cdp);
    // Deposits Alpaca Stablecoin amount into the bookKeeper
    stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, wadD);
    uint256 wadC = convertTo18(tokenAdapter, amtC);
    // Paybacks debt to the CDP and unlocks token amount from it
    adjustPosition(
      manager,
      cdp,
      -toInt(wadC),
      _getWipeDebtShare(
        IManager(manager).bookKeeper(),
        IBookKeeper(IManager(manager).bookKeeper()).stablecoin(positionAddress),
        positionAddress,
        IManager(manager).collateralPools(cdp)
      )
    );
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), wadC);
    // Withdraws token amount to the user's wallet as a token
    IAdapter(tokenAdapter).withdraw(msg.sender, amtC, abi.encode(0));
  }

  function wipeAllAndFreeToken(
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 amtC
  ) public {
    address bookKeeper = IManager(manager).bookKeeper();
    address positionAddress = IManager(manager).positions(cdp);
    bytes32 collateralPoolId = IManager(manager).collateralPools(cdp);
    (, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPoolId, positionAddress);

    // Deposits Alpaca Stablecoin amount into the bookKeeper
    stablecoinAdapter_deposit(
      stablecoinAdapter,
      positionAddress,
      _getWipeAllWad(bookKeeper, positionAddress, positionAddress, collateralPoolId)
    );
    uint256 wadC = convertTo18(tokenAdapter, amtC);
    // Paybacks debt to the CDP and unlocks token amount from it
    adjustPosition(manager, cdp, -toInt(wadC), -int256(debtShare));
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), wadC);
    // Withdraws token amount to the user's wallet as a token
    IAdapter(tokenAdapter).withdraw(msg.sender, amtC, abi.encode(0));
  }
}
