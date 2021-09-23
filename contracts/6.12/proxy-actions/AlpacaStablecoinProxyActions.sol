// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.6.12;

import "../interfaces/IAlpacaVault.sol";
import "../interfaces/IBookKeeper.sol";
import "../interfaces/IWBNB.sol";
import "../interfaces/IToken.sol";
import "../interfaces/IManager.sol";
import "../interfaces/IGenericTokenAdapter.sol";
import "../interfaces/IFarmableTokenAdapter.sol";
import "../interfaces/IStablecoinAdapter.sol";
import "../interfaces/IStabilityFeeCollector.sol";
import "../interfaces/IProxyRegistry.sol";
import "../interfaces/IProxy.sol";
import "../utils/SafeToken.sol";

/// ==============================
/// @notice WARNING: These functions meant to be used as a a library for a Proxy.
/// @notice Hence, it shouldn't has any state vairables. Some are unsafe if you call them directly.
/// ==============================

contract Common {
  using SafeToken for address;

  uint256 internal constant RAY = 10**27;

  /// @notice Internal functions
  /// @dev Safe multiplication to prevent uint overflow
  function _safeMul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x, "mul-overflow");
  }

  /// @notice Public functions
  /// @param adapter The address of stablecoin adapter
  /// @param positionAddress The address of the Position Handler
  /// @param stablecoinAmount The amount in wad to be deposit to Stablecoin adapter
  /// @param data The extra data for stable adapter context
  function stablecoinAdapter_deposit(
    address adapter,
    address positionAddress,
    uint256 stablecoinAmount,
    bytes calldata data
  ) public {
    address stableCoin = address(IStablecoinAdapter(adapter).stablecoin());
    // Gets Alpaca Stablecoin from the user's wallet
    stableCoin.safeTransferFrom(msg.sender, address(this), stablecoinAmount);
    // Approves adapter to take the Alpaca Stablecoin amount
    stableCoin.safeApprove(adapter, stablecoinAmount);
    // Deposits Alpaca Stablecoin into the bookKeeper
    IStablecoinAdapter(adapter).deposit(positionAddress, stablecoinAmount, data);
  }
}

contract AlpacaStablecoinProxyActions is Common {
  using SafeToken for address;

  /// @dev Internal functions
  function _safeSub(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x - y) <= x, "sub-overflow");
  }

  function _safeToInt(uint256 x) internal pure returns (int256 y) {
    y = int256(x);
    require(y >= 0, "int-overflow");
  }

  function _toRad(uint256 wad) internal pure returns (uint256 rad) {
    rad = _safeMul(wad, 10**27);
  }

  function convertTo18(address tokenAdapter, uint256 amt) internal returns (uint256 wad) {
    // For those collaterals that have less than 18 decimals precision we need to do the conversion before passing to adjustPosition function
    // Adapters will automatically handle the difference of precision
    wad = _safeMul(amt, 10**(18 - IGenericTokenAdapter(tokenAdapter).decimals()));
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
    if (stablecoin < _safeMul(wad, RAY)) {
      // Calculates the needed resultDebtShare so together with the existing stablecoin in the bookKeeper is enough to exit wad amount of Alpaca Stablecoin tokens
      resultDebtShare = _safeToInt(_safeSub(_safeMul(wad, RAY), stablecoin) / debtAccumulatedRate);
      // This is neeeded due lack of precision. It might need to sum an extra resultDebtShare wei (for the given Alpaca Stablecoin wad amount)
      resultDebtShare = _safeMul(uint256(resultDebtShare), debtAccumulatedRate) < _safeMul(wad, RAY)
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
    resultDebtShare = _safeToInt(stablecoinBalance / debtAccumulatedRate);
    // Checks the calculated resultDebtShare is not higher than positionAddress.art (total debt), otherwise uses its value
    resultDebtShare = uint256(resultDebtShare) <= debtShare ? -resultDebtShare : -_safeToInt(debtShare);
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

    uint256 rad = _safeSub(_safeMul(debtShare, rate), stablecoin);
    wad = rad / RAY;

    // If the rad precision has some dust, it will need to request for 1 extra wad wei
    wad = _safeMul(wad, RAY) < rad ? wad + 1 : wad;
  }

  // Public functions
  function transfer(
    address collateralToken,
    address dst,
    uint256 amt
  ) public {
    address(collateralToken).safeTransfer(dst, amt);
  }

  function bnbAdapter_deposit(
    address adapter,
    address positionAddress,
    bytes calldata data
  ) public payable {
    address collateralToken = address(IGenericTokenAdapter(adapter).collateralToken());
    // Wraps BNB in WBNB
    IWBNB(collateralToken).deposit{ value: msg.value }();
    // Approves adapter to take the WBNB amount
    collateralToken.safeApprove(address(adapter), msg.value);
    // Deposits WBNB collateral into the bookKeeper
    IGenericTokenAdapter(adapter).deposit(positionAddress, msg.value, data);
  }

  function tokenAdapter_deposit(
    address adapter,
    address positionAddress,
    uint256 amt,
    bool transferFrom,
    bytes calldata data
  ) public {
    address collateralToken = address(IGenericTokenAdapter(adapter).collateralToken());

    // Only executes for tokens that have approval/transferFrom implementation
    if (transferFrom) {
      // Gets token from the user's wallet
      collateralToken.safeTransferFrom(msg.sender, address(this), amt);
      // Approves adapter to take the token amount
      collateralToken.safeApprove(adapter, amt);
    }
    // Deposits token collateral into the bookKeeper
    IGenericTokenAdapter(adapter).deposit(positionAddress, amt, data);
  }

  function hope(address obj, address usr) public {
    IBookKeeper(obj).whitelist(usr);
  }

  function nope(address obj, address usr) public {
    IBookKeeper(obj).blacklist(usr);
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

  /// @dev Allow/Disallow a user to manage the position
  /// @param manager The PositionManager address
  /// @param user The user address that msg.sender would like to allow to manage his position
  /// @param ok The ok flag to allow/disallow
  function allowManagePosition(
    address manager,
    uint256 posID,
    address user,
    uint256 ok
  ) public {
    IManager(manager).allowManagePosition(posID, user, ok);
  }

  /// @dev Allow/Disallow a user to import/export position from/to msg.sender
  /// @param manager The PositionManager address
  /// @param user The user address that msg.sender would like to allow to import/export position from/to
  /// @param ok The ok flag to allow/disallow
  function allowMigratePosition(
    address manager,
    address user,
    uint256 ok
  ) public {
    IManager(manager).allowMigratePosition(user, ok);
  }

  function moveCollateral(
    address manager,
    uint256 cdp,
    address dst,
    uint256 collateralAmount,
    address adapter,
    bytes calldata data
  ) public {
    IManager(manager).moveCollateral(cdp, dst, collateralAmount, adapter, data);
  }

  function moveStablecoin(
    address manager,
    uint256 cdp,
    address dst,
    uint256 stablecoinValue
  ) public {
    IManager(manager).moveStablecoin(cdp, dst, stablecoinValue);
  }

  function adjustPosition(
    address manager,
    uint256 cdp,
    int256 collateralValue,
    int256 debtShare,
    address adapter,
    bytes calldata data
  ) public {
    IManager(manager).adjustPosition(cdp, collateralValue, debtShare, adapter, data);
  }

  function exportPosition(
    address manager,
    uint256 posID,
    address destination
  ) public {
    IManager(manager).exportPosition(posID, destination);
  }

  function importPosition(
    address manager,
    address source,
    uint256 posID
  ) public {
    IManager(manager).importPosition(source, posID);
  }

  function movePosition(
    address manager,
    uint256 source,
    uint256 destination
  ) public {
    IManager(manager).movePosition(source, destination);
  }

  function bnbToIbBNB(address vault, uint256 amt) public payable returns (uint256) {
    SafeToken.safeApprove(address(IAlpacaVault(vault).token()), address(vault), amt);
    uint256 ibBNBBefore = vault.balanceOf(address(this));
    IAlpacaVault(vault).deposit{ value: msg.value }(msg.value);
    uint256 ibBNBAfter = vault.balanceOf(address(this));
    SafeToken.safeApprove(address(IAlpacaVault(vault).token()), address(vault), 0);
    uint256 backIbBNB = _safeSub(ibBNBAfter, ibBNBBefore);
    address(vault).safeTransfer(msg.sender, backIbBNB);
    return backIbBNB;
  }

  function ibBNBToBNB(address vault, uint256 amt) public payable {
    // user requires to approve the proxy wallet before calling this function
    address(vault).safeTransferFrom(msg.sender, address(this), amt);
    uint256 bnbBefore = address(this).balance;
    IAlpacaVault(vault).withdraw(amt);
    uint256 bnbAfter = address(this).balance;
    SafeToken.safeTransferETH(msg.sender, _safeSub(bnbAfter, bnbBefore));
  }

  function tokenToIbToken(address vault, uint256 amt) public returns (uint256) {
    // user requires to approve the proxy wallet before calling this function
    address(IAlpacaVault(vault).token()).safeTransferFrom(msg.sender, address(this), amt);
    SafeToken.safeApprove(address(IAlpacaVault(vault).token()), address(vault), amt);
    uint256 collateralTokenBefore = vault.balanceOf(address(this));
    IAlpacaVault(vault).deposit(amt);
    uint256 collateralTokenAfter = vault.balanceOf(address(this));
    SafeToken.safeApprove(address(IAlpacaVault(vault).token()), address(vault), 0);
    uint256 backCollateralToken = _safeSub(collateralTokenAfter, collateralTokenBefore);
    address(vault).safeTransfer(msg.sender, backCollateralToken);
    return backCollateralToken;
  }

  function ibTokenToToken(address vault, uint256 amt) public {
    // user requires to approve the proxy wallet before calling this function
    address(vault).safeTransferFrom(msg.sender, address(this), amt);
    uint256 baseTokenBefore = IAlpacaVault(vault).token().balanceOf(address(this));
    IAlpacaVault(vault).withdraw(amt);
    uint256 baseTokenAfter = IAlpacaVault(vault).token().balanceOf(address(this));
    address(IAlpacaVault(vault).token()).safeTransfer(msg.sender, _safeSub(baseTokenAfter, baseTokenBefore));
  }

  function lockBNB(
    address manager,
    address bnbAdapter,
    uint256 cdp,
    bytes calldata data
  ) public payable {
    // Receives BNB amount, converts it to WBNB and joins it into the bookKeeper
    bnbAdapter_deposit(bnbAdapter, address(this), data);
    // Locks WBNB amount into the CDP
    IBookKeeper(IManager(manager).bookKeeper()).adjustPosition(
      IManager(manager).collateralPools(cdp),
      IManager(manager).positions(cdp),
      address(this),
      address(this),
      _safeToInt(msg.value),
      0
    );
    IGenericTokenAdapter(bnbAdapter).onAdjustPosition(
      address(this),
      IManager(manager).positions(cdp),
      _safeToInt(msg.value),
      0,
      data
    );
  }

  function safeLockBNB(
    address manager,
    address bnbAdapter,
    uint256 posID,
    address owner,
    bytes calldata data
  ) public payable {
    require(IManager(manager).owners(posID) == owner, "!owner");
    lockBNB(manager, bnbAdapter, posID, data);
  }

  function lockToken(
    address manager,
    address tokenAdapter,
    uint256 cdp,
    uint256 amt,
    bool transferFrom,
    bytes calldata data
  ) public {
    address positionAddress = IManager(manager).positions(cdp);
    // Takes token amount from user's wallet and joins into the bookKeeper
    tokenAdapter_deposit(tokenAdapter, address(this), amt, transferFrom, data);
    // Locks token amount into the CDP
    IBookKeeper(IManager(manager).bookKeeper()).adjustPosition(
      IManager(manager).collateralPools(cdp),
      IManager(manager).positions(cdp),
      address(this),
      address(this),
      _safeToInt(convertTo18(tokenAdapter, amt)),
      0
    );
    IGenericTokenAdapter(tokenAdapter).onAdjustPosition(
      address(this),
      IManager(manager).positions(cdp),
      _safeToInt(convertTo18(tokenAdapter, amt)),
      0,
      data
    );
  }

  function safeLockToken(
    address manager,
    address tokenAdapter,
    uint256 posID,
    uint256 amt,
    bool transferFrom,
    address owner,
    bytes calldata data
  ) public {
    require(IManager(manager).owners(posID) == owner, "!owner");
    lockToken(manager, tokenAdapter, posID, amt, transferFrom, data);
  }

  function freeBNB(
    address manager,
    address bnbAdapter,
    uint256 cdp,
    uint256 amount,
    bytes calldata data
  ) public {
    // Unlocks WBNB amount from the CDP
    adjustPosition(manager, cdp, -_safeToInt(amount), 0, bnbAdapter, data);
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), amount, bnbAdapter, data);
    // Withdraws WBNB amount to proxy address as a token
    IGenericTokenAdapter(bnbAdapter).withdraw(address(this), amount, data);
    // Converts WBNB to BNB
    IWBNB(address(IGenericTokenAdapter(bnbAdapter).collateralToken())).withdraw(amount);
    // Sends BNB back to the user's wallet
    SafeToken.safeTransferETH(msg.sender, amount);
  }

  function freeToken(
    address manager,
    address tokenAdapter,
    uint256 cdp,
    uint256 amount,
    bytes calldata data
  ) public {
    address positionAddress = IManager(manager).positions(cdp);
    uint256 wad = convertTo18(tokenAdapter, amount);
    // Unlocks token amount from the CDP
    adjustPosition(manager, cdp, -_safeToInt(wad), 0, tokenAdapter, data);
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), wad, tokenAdapter, data);
    // Withdraws token amount to the user's wallet as a token
    IGenericTokenAdapter(tokenAdapter).withdraw(msg.sender, amount, data);
  }

  function exitBNB(
    address manager,
    address bnbAdapter,
    uint256 cdp,
    uint256 wad,
    bytes calldata data
  ) public {
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), wad, bnbAdapter, data);

    // Withdraws WBNB amount to proxy address as a token
    IGenericTokenAdapter(bnbAdapter).withdraw(address(this), wad, data);
    // Converts WBNB to BNB
    IWBNB(address(IGenericTokenAdapter(bnbAdapter).collateralToken())).withdraw(wad);
    // Sends BNB back to the user's wallet
    SafeToken.safeTransferETH(msg.sender, wad);
  }

  function exitToken(
    address manager,
    address tokenAdapter,
    uint256 cdp,
    uint256 amt,
    bytes calldata data
  ) public {
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), convertTo18(tokenAdapter, amt), tokenAdapter, data);

    // Withdraws token amount to the user's wallet as a token
    IGenericTokenAdapter(tokenAdapter).withdraw(msg.sender, amt, data);
  }

  function draw(
    address manager,
    address stabilityFeeCollector,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 wad,
    bytes calldata data
  ) public {
    address positionAddress = IManager(manager).positions(cdp);
    address bookKeeper = IManager(manager).bookKeeper();
    bytes32 collateralPoolId = IManager(manager).collateralPools(cdp);
    // Generates debt in the CDP
    adjustPosition(
      manager,
      cdp,
      0,
      _getDrawDebtShare(bookKeeper, stabilityFeeCollector, positionAddress, collateralPoolId, wad),
      address(0),
      data
    );
    // Moves the Alpaca Stablecoin amount (balance in the bookKeeper in rad) to proxy's address
    moveStablecoin(manager, cdp, address(this), _toRad(wad));
    // Allows adapter to access to proxy's Alpaca Stablecoin balance in the bookKeeper
    if (IBookKeeper(bookKeeper).positionWhitelist(address(this), address(stablecoinAdapter)) == 0) {
      IBookKeeper(bookKeeper).whitelist(stablecoinAdapter);
    }
    // Withdraws Alpaca Stablecoin to the user's wallet as a token
    IStablecoinAdapter(stablecoinAdapter).withdraw(msg.sender, wad, data);
  }

  function wipe(
    address manager,
    address stablecoinAdapter,
    uint256 posID,
    uint256 wad,
    bytes calldata data
  ) public {
    address bookKeeper = IManager(manager).bookKeeper();
    address positionAddress = IManager(manager).positions(posID);
    bytes32 collateralPoolId = IManager(manager).collateralPools(posID);

    address own = IManager(manager).owners(posID);
    if (own == address(this) || IManager(manager).ownerWhitelist(own, posID, address(this)) == 1) {
      // Deposits Alpaca Stablecoin amount into the bookKeeper
      stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, wad, data);
      // Paybacks debt to the CDP
      adjustPosition(
        manager,
        posID,
        0,
        _getWipeDebtShare(
          bookKeeper,
          IBookKeeper(bookKeeper).stablecoin(positionAddress),
          positionAddress,
          collateralPoolId
        ),
        address(0),
        data
      );
    } else {
      // Deposits Alpaca Stablecoin amount into the bookKeeper
      stablecoinAdapter_deposit(stablecoinAdapter, address(this), wad, data);
      // Paybacks debt to the CDP
      int256 wipeDebtShare = _getWipeDebtShare(bookKeeper, wad * RAY, positionAddress, collateralPoolId);
      IBookKeeper(bookKeeper).adjustPosition(
        collateralPoolId,
        positionAddress,
        address(this),
        address(this),
        0,
        wipeDebtShare
      );
    }
  }

  function safeWipe(
    address manager,
    address stablecoinAdapter,
    uint256 posID,
    uint256 wad,
    address owner,
    bytes calldata data
  ) public {
    require(IManager(manager).owners(posID) == owner, "!owner");
    wipe(manager, stablecoinAdapter, posID, wad, data);
  }

  function wipeAll(
    address manager,
    address stablecoinAdapter,
    uint256 posID,
    bytes calldata data
  ) public {
    address bookKeeper = IManager(manager).bookKeeper();
    address positionAddress = IManager(manager).positions(posID);
    bytes32 collateralPoolId = IManager(manager).collateralPools(posID);
    (, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPoolId, positionAddress);

    address own = IManager(manager).owners(posID);
    if (own == address(this) || IManager(manager).ownerWhitelist(own, posID, address(this)) == 1) {
      // Deposits Alpaca Stablecoin amount into the bookKeeper
      stablecoinAdapter_deposit(
        stablecoinAdapter,
        positionAddress,
        _getWipeAllWad(bookKeeper, positionAddress, positionAddress, collateralPoolId),
        data
      );
      // Paybacks debt to the CDP
      adjustPosition(manager, posID, 0, -int256(debtShare), address(0), data);
    } else {
      // Deposits Alpaca Stablecoin amount into the bookKeeper
      stablecoinAdapter_deposit(
        stablecoinAdapter,
        address(this),
        _getWipeAllWad(bookKeeper, address(this), positionAddress, collateralPoolId),
        data
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
    uint256 posID,
    address owner,
    bytes calldata data
  ) public {
    require(IManager(manager).owners(posID) == owner, "!owner");
    wipeAll(manager, stablecoinAdapter, posID, data);
  }

  function lockBNBAndDraw(
    address manager,
    address stabilityFeeCollector,
    address bnbAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 stablecoinAmount,
    bytes calldata data
  ) public payable {
    address positionAddress = IManager(manager).positions(cdp);
    address bookKeeper = IManager(manager).bookKeeper();
    bytes32 collateralPoolId = IManager(manager).collateralPools(cdp);
    // Receives BNB amount, converts it to WBNB and joins it into the bookKeeper
    bnbAdapter_deposit(bnbAdapter, positionAddress, data);
    // Locks WBNB amount into the CDP and generates debt
    adjustPosition(
      manager,
      cdp,
      _safeToInt(msg.value),
      _getDrawDebtShare(bookKeeper, stabilityFeeCollector, positionAddress, collateralPoolId, stablecoinAmount),
      bnbAdapter,
      data
    );
    // Moves the Alpaca Stablecoin amount (balance in the bookKeeper in rad) to proxy's address
    moveStablecoin(manager, cdp, address(this), _toRad(stablecoinAmount));
    // Allows adapter to access to proxy's Alpaca Stablecoin balance in the bookKeeper
    if (IBookKeeper(bookKeeper).positionWhitelist(address(this), address(stablecoinAdapter)) == 0) {
      IBookKeeper(bookKeeper).whitelist(stablecoinAdapter);
    }
    // Withdraws Alpaca Stablecoin to the user's wallet as a token
    IStablecoinAdapter(stablecoinAdapter).withdraw(msg.sender, stablecoinAmount, data);
  }

  /// @notice
  function openLockBNBAndDraw(
    address manager,
    address stabilityFeeCollector,
    address bnbAdapter,
    address stablecoinAdapter,
    bytes32 collateralPoolId,
    uint256 stablecoinAmount,
    bytes calldata data
  ) public payable returns (uint256 cdp) {
    cdp = open(manager, collateralPoolId, address(this));
    lockBNBAndDraw(manager, stabilityFeeCollector, bnbAdapter, stablecoinAdapter, cdp, stablecoinAmount, data);
  }

  function lockTokenAndDraw(
    IManager manager,
    address stabilityFeeCollector,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 collateralAmount,
    uint256 stablecoinAmount,
    bool transferFrom,
    bytes calldata data
  ) public {
    bytes32 collateralPoolId = manager.collateralPools(cdp);
    // Takes token amount from user's wallet and joins into the bookKeeper
    tokenAdapter_deposit(tokenAdapter, manager.positions(cdp), collateralAmount, transferFrom, data);
    // Locks token amount into the CDP and generates debt
    int256 collateralValue = _safeToInt(convertTo18(tokenAdapter, collateralAmount));
    int256 drawDebtShare = _getDrawDebtShare(
      manager.bookKeeper(),
      stabilityFeeCollector,
      manager.positions(cdp),
      collateralPoolId,
      stablecoinAmount
    );
    adjustPosition(address(manager), cdp, collateralValue, drawDebtShare, tokenAdapter, data);
    // Moves the Alpaca Stablecoin amount (balance in the bookKeeper in rad) to proxy's address
    moveStablecoin(address(manager), cdp, address(this), _toRad(stablecoinAmount));
    // Allows adapter to access to proxy's Alpaca Stablecoin balance in the bookKeeper
    if (IBookKeeper(manager.bookKeeper()).positionWhitelist(address(this), address(stablecoinAdapter)) == 0) {
      IBookKeeper(manager.bookKeeper()).whitelist(stablecoinAdapter);
    }
    // Withdraws Alpaca Stablecoin to the user's wallet as a token
    IStablecoinAdapter(stablecoinAdapter).withdraw(msg.sender, stablecoinAmount, data);
  }

  function openLockTokenAndDraw(
    address manager,
    address stabilityFeeCollector,
    address tokenAdapter,
    address stablecoinAdapter,
    bytes32 collateralPoolId,
    uint256 collateralAmount,
    uint256 stablecoinAmount,
    bool transferFrom,
    bytes calldata data
  ) public returns (uint256 cdp) {
    cdp = open(manager, collateralPoolId, address(this));
    lockTokenAndDraw(
      IManager(manager),
      stabilityFeeCollector,
      tokenAdapter,
      stablecoinAdapter,
      cdp,
      collateralAmount,
      stablecoinAmount,
      transferFrom,
      data
    );
  }

  function convertBNBOpenLockTokenAndDraw(
    address vault,
    address manager,
    address stabilityFeeCollector,
    address tokenAdapter,
    address stablecoinAdapter,
    bytes32 collateralPoolId,
    uint256 amtT,
    uint256 stablecoinAmount,
    bool transferFrom,
    bytes calldata data
  ) public payable returns (uint256 cdp) {
    uint256 collateralAmount = bnbToIbBNB(vault, msg.value);
    openLockTokenAndDraw(
      manager,
      stabilityFeeCollector,
      tokenAdapter,
      stablecoinAdapter,
      collateralPoolId,
      collateralAmount,
      stablecoinAmount,
      transferFrom,
      data
    );
  }

  function convertOpenLockTokenAndDraw(
    address vault,
    address manager,
    address stabilityFeeCollector,
    address tokenAdapter,
    address stablecoinAdapter,
    bytes32 collateralPoolId,
    uint256 amtT,
    uint256 stablecoinAmount,
    bool transferFrom,
    bytes calldata data
  ) public returns (uint256 cdp) {
    uint256 collateralAmount = tokenToIbToken(vault, amtT);
    openLockTokenAndDraw(
      manager,
      stabilityFeeCollector,
      tokenAdapter,
      stablecoinAdapter,
      collateralPoolId,
      collateralAmount,
      stablecoinAmount,
      transferFrom,
      data
    );
  }

  function wipeAndFreeBNB(
    address manager,
    address bnbAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 collateralAmount,
    uint256 stablecoinAmount,
    bytes calldata data
  ) public {
    address positionAddress = IManager(manager).positions(cdp);
    // Deposits Alpaca Stablecoin amount into the bookKeeper
    stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, stablecoinAmount, data);
    // Paybacks debt to the CDP and unlocks WBNB amount from it
    int256 wipeDebtShare = _getWipeDebtShare(
      IManager(manager).bookKeeper(),
      IBookKeeper(IManager(manager).bookKeeper()).stablecoin(positionAddress),
      positionAddress,
      IManager(manager).collateralPools(cdp)
    );
    adjustPosition(manager, cdp, -_safeToInt(collateralAmount), wipeDebtShare, bnbAdapter, data);
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), collateralAmount, bnbAdapter, data);
    // Withdraws WBNB amount to proxy address as a token
    IGenericTokenAdapter(bnbAdapter).withdraw(address(this), collateralAmount, data);
    // Converts WBNB to BNB
    IWBNB(address(IGenericTokenAdapter(bnbAdapter).collateralToken())).withdraw(collateralAmount);
    // Sends BNB back to the user's wallet
    SafeToken.safeTransferETH(msg.sender, collateralAmount);
  }

  function wipeAllAndFreeBNB(
    address manager,
    address bnbAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 collateralAmount,
    bytes calldata data
  ) public {
    address bookKeeper = IManager(manager).bookKeeper();
    address positionAddress = IManager(manager).positions(cdp);
    bytes32 collateralPoolId = IManager(manager).collateralPools(cdp);
    (, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPoolId, positionAddress);

    // Deposits Alpaca Stablecoin amount into the bookKeeper
    stablecoinAdapter_deposit(
      stablecoinAdapter,
      positionAddress,
      _getWipeAllWad(bookKeeper, positionAddress, positionAddress, collateralPoolId),
      data
    );
    // Paybacks debt to the CDP and unlocks WBNB amount from it
    adjustPosition(manager, cdp, -_safeToInt(collateralAmount), -int256(debtShare), bnbAdapter, data);
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), collateralAmount, bnbAdapter, data);
    // Withdraws WBNB amount to proxy address as a token
    IGenericTokenAdapter(bnbAdapter).withdraw(address(this), collateralAmount, data);
    // Converts WBNB to BNB
    IWBNB(address(IGenericTokenAdapter(bnbAdapter).collateralToken())).withdraw(collateralAmount);
    // Sends BNB back to the user's wallet
    SafeToken.safeTransferETH(msg.sender, collateralAmount);
  }

  function wipeAndFreeToken(
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 collateralAmount,
    uint256 stablecoinAmount,
    bytes calldata data
  ) public {
    address positionAddress = IManager(manager).positions(cdp);
    // Deposits Alpaca Stablecoin amount into the bookKeeper
    stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, stablecoinAmount, data);
    uint256 collateralAmount = convertTo18(tokenAdapter, collateralAmount);
    // Paybacks debt to the CDP and unlocks token amount from it
    int256 wipeDebtShare = _getWipeDebtShare(
      IManager(manager).bookKeeper(),
      IBookKeeper(IManager(manager).bookKeeper()).stablecoin(positionAddress),
      positionAddress,
      IManager(manager).collateralPools(cdp)
    );
    adjustPosition(manager, cdp, -_safeToInt(collateralAmount), wipeDebtShare, tokenAdapter, data);
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), collateralAmount, tokenAdapter, data);
    // Withdraws token amount to the user's wallet as a token
    IGenericTokenAdapter(tokenAdapter).withdraw(msg.sender, collateralAmount, data);
  }

  function wipeFreeIbBNBAndCovertToBNB(
    address vault,
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 collateralAmount,
    uint256 stablecoinAmount,
    bytes calldata data
  ) public {
    wipeAndFreeToken(manager, tokenAdapter, stablecoinAdapter, cdp, collateralAmount, stablecoinAmount, data);
    ibBNBToBNB(vault, collateralAmount);
  }

  function wipeFreeTokenAndConvert(
    address vault,
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 collateralAmount,
    uint256 stablecoinAmount,
    bytes calldata data
  ) public {
    wipeAndFreeToken(manager, tokenAdapter, stablecoinAdapter, cdp, collateralAmount, stablecoinAmount, data);
    ibTokenToToken(vault, collateralAmount);
  }

  function wipeAllAndFreeToken(
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 collateralAmount,
    bytes calldata data
  ) public {
    address bookKeeper = IManager(manager).bookKeeper();
    address positionAddress = IManager(manager).positions(cdp);
    bytes32 collateralPoolId = IManager(manager).collateralPools(cdp);
    (, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPoolId, positionAddress);

    // Deposits Alpaca Stablecoin amount into the bookKeeper
    stablecoinAdapter_deposit(
      stablecoinAdapter,
      positionAddress,
      _getWipeAllWad(bookKeeper, positionAddress, positionAddress, collateralPoolId),
      data
    );
    uint256 collateralAmount = convertTo18(tokenAdapter, collateralAmount);
    // Paybacks debt to the CDP and unlocks token amount from it
    adjustPosition(manager, cdp, -_safeToInt(collateralAmount), -int256(debtShare), tokenAdapter, data);
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, cdp, address(this), collateralAmount, tokenAdapter, data);
    // Withdraws token amount to the user's wallet as a token
    IGenericTokenAdapter(tokenAdapter).withdraw(msg.sender, collateralAmount, data);
  }

  function wipeAllFreeIbBNBAndConvertToBNB(
    address vault,
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 collateralAmount,
    bytes calldata data
  ) public {
    wipeAllAndFreeToken(manager, tokenAdapter, stablecoinAdapter, cdp, collateralAmount, data);
    ibBNBToBNB(vault, collateralAmount);
  }

  function wipeAllFreeTokenAndConvert(
    address vault,
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 cdp,
    uint256 collateralAmount,
    bytes calldata data
  ) public {
    wipeAllAndFreeToken(manager, tokenAdapter, stablecoinAdapter, cdp, collateralAmount, data);
    ibTokenToToken(vault, collateralAmount);
  }
}
