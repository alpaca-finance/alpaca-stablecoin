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

contract AlpacaStablecoinProxyActions {
  using SafeToken for address;

  uint256 internal constant RAY = 10**27;

  /// @dev Internal functions
  function _safeSub(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x - y) <= x, "sub-overflow");
  }

  function _safeToInt(uint256 x) internal pure returns (int256 y) {
    y = int256(x);
    require(y >= 0, "int-overflow");
  }

  /// @notice Internal functions
  /// @dev Safe multiplication to prevent uint overflow
  function _safeMul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x, "mul-overflow");
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
    uint256 stablecoinAmount // [wad]
  ) internal returns (int256 resultDebtShare) {
    // Updates stability fee rate
    uint256 debtAccumulatedRate = IStabilityFeeCollector(stabilityFeeCollector).collect(collateralPoolId); // [ray]

    // Gets Alpaca Stablecoin balance of the positionAddress in the bookKeeper
    uint256 positionStablecoinValue = IBookKeeper(bookKeeper).stablecoin(positionAddress); // [rad]

    // If there was already enough Alpaca Stablecoin in the bookKeeper balance, just exits it without adding more debt
    if (positionStablecoinValue < _safeMul(stablecoinAmount, RAY)) {
      // Calculates the needed resultDebtShare so together with the existing positionStablecoinValue in the bookKeeper is enough to exit stablecoinAmount of Alpaca Stablecoin tokens
      resultDebtShare = _safeToInt(
        _safeSub(_safeMul(stablecoinAmount, RAY), positionStablecoinValue) / debtAccumulatedRate
      );
      // This is neeeded due lack of precision. It might need to sum an extra resultDebtShare wei (for the given Alpaca Stablecoin stablecoinAmount)
      resultDebtShare = _safeMul(uint256(resultDebtShare), debtAccumulatedRate) < _safeMul(stablecoinAmount, RAY)
        ? resultDebtShare + 1
        : resultDebtShare;
    }
  }

  function _getWipeDebtShare(
    address bookKeeper,
    uint256 stablecoinValue, // [rad]
    address positionAddress,
    bytes32 collateralPoolId
  ) internal view returns (int256 resultDebtShare) {
    // Gets actual rate from the bookKeeper
    (, uint256 debtAccumulatedRate, , , ) = IBookKeeper(bookKeeper).collateralPools(collateralPoolId); // [ray]
    // Gets actual debtShare value of the positionAddress
    (, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPoolId, positionAddress); // [wad]

    // Uses the whole stablecoin balance in the bookKeeper to reduce the debt
    resultDebtShare = _safeToInt(stablecoinValue / debtAccumulatedRate); // [wad]
    // Checks the calculated resultDebtShare is not higher than positionAddress.art (total debt), otherwise uses its value
    resultDebtShare = uint256(resultDebtShare) <= debtShare ? -resultDebtShare : -_safeToInt(debtShare); // [wad]
  }

  function _getWipeAllStablecoinAmount(
    address bookKeeper,
    address usr,
    address positionAddress,
    bytes32 collateralPoolId
  ) internal view returns (uint256 requiredStablecoinAmount) {
    // Gets actual rate from the bookKeeper
    (, uint256 rate, , , ) = IBookKeeper(bookKeeper).collateralPools(collateralPoolId); // [ray]
    // Gets actual debtShare value of the positionAddress
    (, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPoolId, positionAddress); // [wad]
    // Gets actual stablecoin amount in the usr
    uint256 stablecoinValue = IBookKeeper(bookKeeper).stablecoin(usr); // [rad]

    uint256 requiredStablecoinValue = _safeSub(_safeMul(debtShare, rate), stablecoinValue);
    requiredStablecoinAmount = requiredStablecoinValue / RAY;

    // If the value precision has some dust, it will need to request for 1 extra amount wei
    requiredStablecoinAmount = _safeMul(requiredStablecoinAmount, RAY) < requiredStablecoinValue
      ? requiredStablecoinAmount + 1
      : requiredStablecoinAmount;
  }

  /// @notice Public functions
  /// @param adapter The address of stablecoin adapter
  /// @param positionAddress The address of the Position Handler
  /// @param stablecoinAmount The amount in wad to be deposit to Stablecoin adapter [wad]
  /// @param data The extra data for stable adapter context
  function stablecoinAdapterDeposit(
    address adapter,
    address positionAddress,
    uint256 stablecoinAmount, // [wad]
    bytes calldata data
  ) public {
    address stablecoin = address(IStablecoinAdapter(adapter).stablecoin());
    // Gets Alpaca Stablecoin from the user's wallet
    stablecoin.safeTransferFrom(msg.sender, address(this), stablecoinAmount);
    // Approves adapter to take the Alpaca Stablecoin amount
    stablecoin.safeApprove(adapter, stablecoinAmount);
    // Deposits Alpaca Stablecoin into the bookKeeper
    IStablecoinAdapter(adapter).deposit(positionAddress, stablecoinAmount, data);
  }

  // Public functions
  function transfer(
    address collateralToken,
    address dst,
    uint256 amt
  ) public {
    address(collateralToken).safeTransfer(dst, amt);
  }

  function bnbAdapterDeposit(
    address adapter,
    address positionAddress,
    bytes calldata data
  ) public payable {
    address collateralToken = address(IGenericTokenAdapter(adapter).collateralToken());
    // Wraps BNB into WBNB
    IWBNB(collateralToken).deposit{ value: msg.value }();
    // Approves adapter to take the WBNB amount
    collateralToken.safeApprove(address(adapter), msg.value);
    // Deposits WBNB collateral into the bookKeeper
    IGenericTokenAdapter(adapter).deposit(positionAddress, msg.value, data);
  }

  function tokenAdapterDeposit(
    address adapter,
    address positionAddress,
    uint256 amount, // [wad]
    bool transferFrom,
    bytes calldata data
  ) public {
    address collateralToken = address(IGenericTokenAdapter(adapter).collateralToken());

    // Only executes for tokens that have approval/transferFrom implementation
    if (transferFrom) {
      // Gets token from the user's wallet
      collateralToken.safeTransferFrom(msg.sender, address(this), amount);
      // Approves adapter to take the token amount
      collateralToken.safeApprove(adapter, amount);
    }
    // Deposits token collateral into the bookKeeper
    IGenericTokenAdapter(adapter).deposit(positionAddress, amount, data);
  }

  function whitelist(address bookKeeper, address usr) public {
    IBookKeeper(bookKeeper).whitelist(usr);
  }

  function blacklist(address bookKeeper, address usr) public {
    IBookKeeper(bookKeeper).blacklist(usr);
  }

  function open(
    address manager,
    bytes32 collateralPoolId,
    address usr
  ) public returns (uint256 positionId) {
    positionId = IManager(manager).open(collateralPoolId, usr);
  }

  function transferOwnership(
    address manager,
    uint256 positionId,
    address usr
  ) public {
    IManager(manager).give(positionId, usr);
  }

  function transferOwnershipToProxy(
    address proxyRegistry,
    address manager,
    uint256 positionId,
    address dst
  ) public {
    // Gets actual proxy address
    address proxy = IProxyRegistry(proxyRegistry).proxies(dst);
    // Checks if the proxy address already existed and dst address is still the owner
    if (proxy == address(0) || IProxy(proxy).owner() != dst) {
      uint256 codeSize;
      assembly {
        codeSize := extcodesize(dst)
      }
      // We want to avoid creating a proxy for a contract address that might not be able to handle proxies, then losing the CDP
      require(codeSize == 0, "Dst-is-a-contract");
      // Creates the proxy for the dst address
      proxy = IProxyRegistry(proxyRegistry).build(dst);
    }
    // Transfers position to the dst proxy
    transferOwnership(manager, positionId, proxy);
  }

  /// @dev Allow/Disallow a user to manage the position
  /// @param manager The PositionManager address
  /// @param user The user address that msg.sender would like to allow to manage his position
  /// @param ok The ok flag to allow/disallow
  function allowManagePosition(
    address manager,
    uint256 positionId,
    address user,
    uint256 ok
  ) public {
    IManager(manager).allowManagePosition(positionId, user, ok);
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
    uint256 positionId,
    address dst,
    uint256 collateralAmount,
    address adapter,
    bytes calldata data
  ) public {
    IManager(manager).moveCollateral(positionId, dst, collateralAmount, adapter, data);
  }

  function moveStablecoin(
    address manager,
    uint256 positionId,
    address dst,
    uint256 stablecoinValue // [rad]
  ) public {
    IManager(manager).moveStablecoin(positionId, dst, stablecoinValue);
  }

  function adjustPosition(
    address manager,
    uint256 positionId,
    int256 collateralValue,
    int256 debtShare, // [wad]
    address adapter,
    bytes calldata data
  ) public {
    IManager(manager).adjustPosition(positionId, collateralValue, debtShare, adapter, data);
  }

  function exportPosition(
    address manager,
    uint256 positionId,
    address destination
  ) public {
    IManager(manager).exportPosition(positionId, destination);
  }

  function importPosition(
    address manager,
    address source,
    uint256 positionId
  ) public {
    IManager(manager).importPosition(source, positionId);
  }

  function movePosition(
    address manager,
    uint256 source,
    uint256 destination
  ) public {
    IManager(manager).movePosition(source, destination);
  }

  function bnbToIbBNB(
    address vault,
    uint256 amount // [wad]
  ) public payable returns (uint256) {
    SafeToken.safeApprove(address(IAlpacaVault(vault).token()), address(vault), amount);
    uint256 ibBNBBefore = vault.balanceOf(address(this));
    IAlpacaVault(vault).deposit{ value: msg.value }(msg.value);
    uint256 ibBNBAfter = vault.balanceOf(address(this));
    SafeToken.safeApprove(address(IAlpacaVault(vault).token()), address(vault), 0);
    uint256 backIbBNB = _safeSub(ibBNBAfter, ibBNBBefore);
    address(vault).safeTransfer(msg.sender, backIbBNB);
    return backIbBNB;
  }

  function ibBNBToBNB(
    address vault,
    uint256 amount // [wad]
  ) public payable {
    // user requires to approve the proxy wallet before calling this function
    address(vault).safeTransferFrom(msg.sender, address(this), amount);
    uint256 bnbBefore = address(this).balance;
    IAlpacaVault(vault).withdraw(amount);
    uint256 bnbAfter = address(this).balance;
    SafeToken.safeTransferETH(msg.sender, _safeSub(bnbAfter, bnbBefore));
  }

  function tokenToIbToken(
    address vault,
    uint256 amount // [wad]
  ) public returns (uint256) {
    // user requires to approve the proxy wallet before calling this function
    address(IAlpacaVault(vault).token()).safeTransferFrom(msg.sender, address(this), amount);
    SafeToken.safeApprove(address(IAlpacaVault(vault).token()), address(vault), amount);
    uint256 collateralTokenBefore = vault.balanceOf(address(this));
    IAlpacaVault(vault).deposit(amount);
    uint256 collateralTokenAfter = vault.balanceOf(address(this));
    SafeToken.safeApprove(address(IAlpacaVault(vault).token()), address(vault), 0);
    uint256 backCollateralToken = _safeSub(collateralTokenAfter, collateralTokenBefore);
    address(vault).safeTransfer(msg.sender, backCollateralToken);
    return backCollateralToken;
  }

  function ibTokenToToken(
    address vault,
    uint256 amount // [wad]
  ) public {
    // user requires to approve the proxy wallet before calling this function
    address(vault).safeTransferFrom(msg.sender, address(this), amount);
    uint256 baseTokenBefore = IAlpacaVault(vault).token().balanceOf(address(this));
    IAlpacaVault(vault).withdraw(amount);
    uint256 baseTokenAfter = IAlpacaVault(vault).token().balanceOf(address(this));
    address(IAlpacaVault(vault).token()).safeTransfer(msg.sender, _safeSub(baseTokenAfter, baseTokenBefore));
  }

  function lockBNB(
    address manager,
    address bnbAdapter,
    uint256 positionId,
    bytes calldata data
  ) public payable {
    // Receives BNB amount, converts it to WBNB and joins it into the bookKeeper
    bnbAdapterDeposit(bnbAdapter, address(this), data);
    // Locks WBNB amount into the CDP
    IBookKeeper(IManager(manager).bookKeeper()).adjustPosition(
      IManager(manager).collateralPools(positionId),
      IManager(manager).positions(positionId),
      address(this),
      address(this),
      _safeToInt(msg.value),
      0
    );
    IGenericTokenAdapter(bnbAdapter).onAdjustPosition(
      address(this),
      IManager(manager).positions(positionId),
      _safeToInt(msg.value),
      0,
      data
    );
  }

  function safeLockBNB(
    address manager,
    address bnbAdapter,
    uint256 positionId,
    address owner,
    bytes calldata data
  ) public payable {
    require(IManager(manager).owners(positionId) == owner, "!owner");
    lockBNB(manager, bnbAdapter, positionId, data);
  }

  function lockToken(
    address manager,
    address tokenAdapter,
    uint256 positionId,
    uint256 amount, // [in token decimal]
    bool transferFrom,
    bytes calldata data
  ) public {
    address positionAddress = IManager(manager).positions(positionId);

    // Takes token amount from user's wallet and joins into the bookKeeper
    tokenAdapterDeposit(tokenAdapter, address(this), amount, transferFrom, data);
    // Locks token amount into the CDP
    IBookKeeper(IManager(manager).bookKeeper()).adjustPosition(
      IManager(manager).collateralPools(positionId),
      positionAddress,
      address(this),
      address(this),
      _safeToInt(convertTo18(tokenAdapter, amount)),
      0
    );
    IGenericTokenAdapter(tokenAdapter).onAdjustPosition(
      address(this),
      positionAddress,
      _safeToInt(convertTo18(tokenAdapter, amount)),
      0,
      data
    );
  }

  function safeLockToken(
    address manager,
    address tokenAdapter,
    uint256 positionId,
    uint256 amount, // [wad]
    bool transferFrom,
    address owner,
    bytes calldata data
  ) public {
    require(IManager(manager).owners(positionId) == owner, "!owner");
    lockToken(manager, tokenAdapter, positionId, amount, transferFrom, data);
  }

  function unlockBNB(
    address manager,
    address bnbAdapter,
    uint256 positionId,
    uint256 amount, // [wad]
    bytes calldata data
  ) public {
    // Unlocks WBNB amount from the CDP
    adjustPosition(manager, positionId, -_safeToInt(amount), 0, bnbAdapter, data);
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, positionId, address(this), amount, bnbAdapter, data);
    // Withdraws WBNB amount to proxy address as a token
    IGenericTokenAdapter(bnbAdapter).withdraw(address(this), amount, data);
    // Converts WBNB to BNB
    IWBNB(address(IGenericTokenAdapter(bnbAdapter).collateralToken())).withdraw(amount);
    // Sends BNB back to the user's wallet
    SafeToken.safeTransferETH(msg.sender, amount);
  }

  function unlockToken(
    address manager,
    address tokenAdapter,
    uint256 positionId,
    uint256 amount, // [in token decimal]
    bytes calldata data
  ) public {
    uint256 amountInWad = convertTo18(tokenAdapter, amount);
    // Unlocks token amount from the position
    adjustPosition(manager, positionId, -_safeToInt(amountInWad), 0, tokenAdapter, data);
    // Moves the amount from the position to proxy's address
    moveCollateral(manager, positionId, address(this), amountInWad, tokenAdapter, data);
    // Withdraws token amount to the user's wallet as a token
    IGenericTokenAdapter(tokenAdapter).withdraw(msg.sender, amount, data);
  }

  function withdrawBNB(
    address manager,
    address bnbAdapter,
    uint256 positionId,
    uint256 amount, // [wad]
    bytes calldata data
  ) public {
    // Moves the amount from the position to proxy's address
    moveCollateral(manager, positionId, address(this), amount, bnbAdapter, data);

    // Withdraws WBNB amount to proxy address as a token
    IGenericTokenAdapter(bnbAdapter).withdraw(address(this), amount, data);
    // Converts WBNB to BNB
    IWBNB(address(IGenericTokenAdapter(bnbAdapter).collateralToken())).withdraw(amount);
    // Sends BNB back to the user's wallet
    SafeToken.safeTransferETH(msg.sender, amount);
  }

  function withdrawToken(
    address manager,
    address tokenAdapter,
    uint256 positionId,
    uint256 amount, // [in token decimal]
    bytes calldata data
  ) public {
    // Moves the amount from the position to proxy's address
    moveCollateral(manager, positionId, address(this), convertTo18(tokenAdapter, amount), tokenAdapter, data);

    // Withdraws token amount to the user's wallet as a token
    IGenericTokenAdapter(tokenAdapter).withdraw(msg.sender, amount, data);
  }

  function draw(
    address manager,
    address stabilityFeeCollector,
    address stablecoinAdapter,
    uint256 positionId,
    uint256 amount, // [wad]
    bytes calldata data
  ) public {
    address positionAddress = IManager(manager).positions(positionId);
    address bookKeeper = IManager(manager).bookKeeper();
    bytes32 collateralPoolId = IManager(manager).collateralPools(positionId);
    // Generates debt in the CDP
    adjustPosition(
      manager,
      positionId,
      0,
      _getDrawDebtShare(bookKeeper, stabilityFeeCollector, positionAddress, collateralPoolId, amount),
      address(0),
      data
    );
    // Moves the Alpaca Stablecoin amount (balance in the bookKeeper in rad) to proxy's address
    moveStablecoin(manager, positionId, address(this), _toRad(amount));
    // Allows adapter to access to proxy's Alpaca Stablecoin balance in the bookKeeper
    if (IBookKeeper(bookKeeper).positionWhitelist(address(this), address(stablecoinAdapter)) == 0) {
      IBookKeeper(bookKeeper).whitelist(stablecoinAdapter);
    }
    // Withdraws Alpaca Stablecoin to the user's wallet as a token
    IStablecoinAdapter(stablecoinAdapter).withdraw(msg.sender, amount, data);
  }

  function wipe(
    address manager,
    address stablecoinAdapter,
    uint256 positionId,
    uint256 amount, // [wad]
    bytes calldata data
  ) public {
    address bookKeeper = IManager(manager).bookKeeper();
    address positionAddress = IManager(manager).positions(positionId);
    bytes32 collateralPoolId = IManager(manager).collateralPools(positionId);

    address owner = IManager(manager).owners(positionId);
    if (owner == address(this) || IManager(manager).ownerWhitelist(owner, positionId, address(this)) == 1) {
      // Deposits Alpaca Stablecoin amount into the bookKeeper
      stablecoinAdapterDeposit(stablecoinAdapter, positionAddress, amount, data);
      // Paybacks debt to the CDP
      adjustPosition(
        manager,
        positionId,
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
      stablecoinAdapterDeposit(stablecoinAdapter, address(this), amount, data);
      // Paybacks debt to the position
      int256 wipeDebtShare = _getWipeDebtShare(bookKeeper, amount * RAY, positionAddress, collateralPoolId);
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
    uint256 positionId,
    uint256 amount, // [wad]
    address owner,
    bytes calldata data
  ) public {
    require(IManager(manager).owners(positionId) == owner, "!owner");
    wipe(manager, stablecoinAdapter, positionId, amount, data);
  }

  function wipeAll(
    address manager,
    address stablecoinAdapter,
    uint256 positionId,
    bytes calldata data
  ) public {
    address bookKeeper = IManager(manager).bookKeeper();
    address positionAddress = IManager(manager).positions(positionId);
    bytes32 collateralPoolId = IManager(manager).collateralPools(positionId);
    (, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPoolId, positionAddress); // [wad]

    address owner = IManager(manager).owners(positionId);
    if (owner == address(this) || IManager(manager).ownerWhitelist(owner, positionId, address(this)) == 1) {
      // Deposits Alpaca Stablecoin amount into the bookKeeper
      stablecoinAdapterDeposit(
        stablecoinAdapter,
        positionAddress,
        _getWipeAllStablecoinAmount(bookKeeper, positionAddress, positionAddress, collateralPoolId),
        data
      );
      // Paybacks debt to the CDP
      adjustPosition(manager, positionId, 0, -int256(debtShare), address(0), data);
    } else {
      // Deposits Alpaca Stablecoin amount into the bookKeeper
      stablecoinAdapterDeposit(
        stablecoinAdapter,
        address(this),
        _getWipeAllStablecoinAmount(bookKeeper, address(this), positionAddress, collateralPoolId),
        data
      );
      // Paybacks debt to the position
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
    uint256 positionId,
    address owner,
    bytes calldata data
  ) public {
    require(IManager(manager).owners(positionId) == owner, "!owner");
    wipeAll(manager, stablecoinAdapter, positionId, data);
  }

  function lockBNBAndDraw(
    address manager,
    address stabilityFeeCollector,
    address bnbAdapter,
    address stablecoinAdapter,
    uint256 positionId,
    uint256 stablecoinAmount, // [wad]
    bytes calldata data
  ) public payable {
    address positionAddress = IManager(manager).positions(positionId);
    address bookKeeper = IManager(manager).bookKeeper();
    bytes32 collateralPoolId = IManager(manager).collateralPools(positionId);
    // Receives BNB amount, converts it to WBNB and joins it into the bookKeeper
    bnbAdapterDeposit(bnbAdapter, positionAddress, data);
    // Locks WBNB amount into the CDP and generates debt
    adjustPosition(
      manager,
      positionId,
      _safeToInt(msg.value),
      _getDrawDebtShare(bookKeeper, stabilityFeeCollector, positionAddress, collateralPoolId, stablecoinAmount),
      bnbAdapter,
      data
    );
    // Moves the Alpaca Stablecoin amount (balance in the bookKeeper in rad) to proxy's address
    moveStablecoin(manager, positionId, address(this), _toRad(stablecoinAmount));
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
    uint256 stablecoinAmount, // [wad]
    bytes calldata data
  ) public payable returns (uint256 positionId) {
    positionId = open(manager, collateralPoolId, address(this));
    lockBNBAndDraw(manager, stabilityFeeCollector, bnbAdapter, stablecoinAdapter, positionId, stablecoinAmount, data);
  }

  function lockTokenAndDraw(
    IManager manager,
    address stabilityFeeCollector,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 positionId,
    uint256 collateralAmount, // [in token decimal]
    uint256 stablecoinAmount, // [wad]
    bool transferFrom,
    bytes calldata data
  ) public {
    bytes32 collateralPoolId = manager.collateralPools(positionId);
    // Takes token amount from user's wallet and joins into the bookKeeper
    tokenAdapterDeposit(tokenAdapter, manager.positions(positionId), collateralAmount, transferFrom, data);
    // Locks token amount into the position and generates debt
    int256 collateralAmountInWad = _safeToInt(convertTo18(tokenAdapter, collateralAmount));
    int256 drawDebtShare = _getDrawDebtShare(
      manager.bookKeeper(),
      stabilityFeeCollector,
      manager.positions(positionId),
      collateralPoolId,
      stablecoinAmount
    ); // [wad]
    adjustPosition(address(manager), positionId, collateralAmountInWad, drawDebtShare, tokenAdapter, data);
    // Moves the Alpaca Stablecoin amount (balance in the bookKeeper in rad) to proxy's address
    moveStablecoin(address(manager), positionId, address(this), _toRad(stablecoinAmount));
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
    uint256 collateralAmount, // [in token decimal]
    uint256 stablecoinAmount, // [wad]
    bool transferFrom,
    bytes calldata data
  ) public returns (uint256 positionId) {
    positionId = open(manager, collateralPoolId, address(this));
    lockTokenAndDraw(
      IManager(manager),
      stabilityFeeCollector,
      tokenAdapter,
      stablecoinAdapter,
      positionId,
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
    uint256 stablecoinAmount, // [wad]
    bool transferFrom,
    bytes calldata data
  ) public payable returns (uint256 positionId) {
    uint256 collateralAmount = bnbToIbBNB(vault, msg.value);
    return
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
    uint256 tokenAmount, // [in token decimal]
    uint256 stablecoinAmount, // [wad]
    bool transferFrom,
    bytes calldata data
  ) public returns (uint256 positionId) {
    uint256 collateralAmount = tokenToIbToken(vault, convertTo18(tokenAdapter, tokenAmount));
    return
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

  function wipeAndUnlockBNB(
    address manager,
    address bnbAdapter,
    address stablecoinAdapter,
    uint256 positionId,
    uint256 collateralAmount, // [wad]
    uint256 stablecoinAmount, // [wad]
    bytes calldata data
  ) public {
    address positionAddress = IManager(manager).positions(positionId);
    // Deposits Alpaca Stablecoin amount into the bookKeeper
    stablecoinAdapterDeposit(stablecoinAdapter, positionAddress, stablecoinAmount, data);
    // Paybacks debt to the position and unlocks WBNB amount from it
    int256 wipeDebtShare = _getWipeDebtShare(
      IManager(manager).bookKeeper(),
      IBookKeeper(IManager(manager).bookKeeper()).stablecoin(positionAddress),
      positionAddress,
      IManager(manager).collateralPools(positionId)
    ); // [wad]
    adjustPosition(manager, positionId, -_safeToInt(collateralAmount), wipeDebtShare, bnbAdapter, data);
    // Moves the amount from the position to proxy's address
    moveCollateral(manager, positionId, address(this), collateralAmount, bnbAdapter, data);
    // Withdraws WBNB amount to proxy address as a token
    IGenericTokenAdapter(bnbAdapter).withdraw(address(this), collateralAmount, data);
    // Converts WBNB to BNB
    IWBNB(address(IGenericTokenAdapter(bnbAdapter).collateralToken())).withdraw(collateralAmount);
    // Sends BNB back to the user's wallet
    SafeToken.safeTransferETH(msg.sender, collateralAmount);
  }

  function wipeAllAndUnlockBNB(
    address manager,
    address bnbAdapter,
    address stablecoinAdapter,
    uint256 positionId,
    uint256 collateralAmount, // [wad]
    bytes calldata data
  ) public {
    address bookKeeper = IManager(manager).bookKeeper();
    address positionAddress = IManager(manager).positions(positionId);
    bytes32 collateralPoolId = IManager(manager).collateralPools(positionId);
    (, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPoolId, positionAddress); // [wad]

    // Deposits Alpaca Stablecoin amount into the bookKeeper
    stablecoinAdapterDeposit(
      stablecoinAdapter,
      positionAddress,
      _getWipeAllStablecoinAmount(bookKeeper, positionAddress, positionAddress, collateralPoolId),
      data
    );
    // Paybacks debt to the CDP and unlocks WBNB amount from it
    adjustPosition(manager, positionId, -_safeToInt(collateralAmount), -int256(debtShare), bnbAdapter, data);
    // Moves the amount from the CDP positionAddress to proxy's address
    moveCollateral(manager, positionId, address(this), collateralAmount, bnbAdapter, data);
    // Withdraws WBNB amount to proxy address as a token
    IGenericTokenAdapter(bnbAdapter).withdraw(address(this), collateralAmount, data);
    // Converts WBNB to BNB
    IWBNB(address(IGenericTokenAdapter(bnbAdapter).collateralToken())).withdraw(collateralAmount);
    // Sends BNB back to the user's wallet
    SafeToken.safeTransferETH(msg.sender, collateralAmount);
  }

  function wipeAndUnlockToken(
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 positionId,
    uint256 collateralAmount, // [in token decimal]
    uint256 stablecoinAmount, // [wad]
    bytes calldata data
  ) public {
    address positionAddress = IManager(manager).positions(positionId);
    // Deposits Alpaca Stablecoin amount into the bookKeeper
    stablecoinAdapterDeposit(stablecoinAdapter, positionAddress, stablecoinAmount, data);
    uint256 collateralAmountInWad = convertTo18(tokenAdapter, collateralAmount);
    // Paybacks debt to the CDP and unlocks token amount from it
    int256 wipeDebtShare = _getWipeDebtShare(
      IManager(manager).bookKeeper(),
      IBookKeeper(IManager(manager).bookKeeper()).stablecoin(positionAddress),
      positionAddress,
      IManager(manager).collateralPools(positionId)
    );
    adjustPosition(manager, positionId, -_safeToInt(collateralAmountInWad), wipeDebtShare, tokenAdapter, data);
    // Moves the amount from the position to proxy's address
    moveCollateral(manager, positionId, address(this), collateralAmountInWad, tokenAdapter, data);
    // Withdraws token amount to the user's wallet as a token
    IGenericTokenAdapter(tokenAdapter).withdraw(msg.sender, collateralAmountInWad, data);
  }

  function wipeUnlockIbBNBAndCovertToBNB(
    address vault,
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 positionId,
    uint256 collateralAmount, // [wad]
    uint256 stablecoinAmount, // [wad]
    bytes calldata data
  ) public {
    wipeAndUnlockToken(manager, tokenAdapter, stablecoinAdapter, positionId, collateralAmount, stablecoinAmount, data);
    ibBNBToBNB(vault, collateralAmount);
  }

  function wipeUnlockTokenAndConvert(
    address vault,
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 positionId,
    uint256 collateralAmount, // [token decimal]
    uint256 stablecoinAmount, // [wad]
    bytes calldata data
  ) public {
    wipeAndUnlockToken(manager, tokenAdapter, stablecoinAdapter, positionId, collateralAmount, stablecoinAmount, data);
    ibTokenToToken(vault, convertTo18(tokenAdapter, collateralAmount));
  }

  function wipeAllAndUnlockToken(
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 positionId,
    uint256 collateralAmount, // [token decimal]
    bytes calldata data
  ) public {
    address bookKeeper = IManager(manager).bookKeeper();
    address positionAddress = IManager(manager).positions(positionId);
    bytes32 collateralPoolId = IManager(manager).collateralPools(positionId);
    (, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPoolId, positionAddress);

    // Deposits Alpaca Stablecoin amount into the bookKeeper
    stablecoinAdapterDeposit(
      stablecoinAdapter,
      positionAddress,
      _getWipeAllStablecoinAmount(bookKeeper, positionAddress, positionAddress, collateralPoolId),
      data
    );
    uint256 collateralAmountInWad = convertTo18(tokenAdapter, collateralAmount);
    // Paybacks debt to the position and unlocks token amount from it
    adjustPosition(manager, positionId, -_safeToInt(collateralAmountInWad), -int256(debtShare), tokenAdapter, data);
    // Moves the amount from the position to proxy's address
    moveCollateral(manager, positionId, address(this), collateralAmountInWad, tokenAdapter, data);
    // Withdraws token amount to the user's wallet as a token
    IGenericTokenAdapter(tokenAdapter).withdraw(msg.sender, collateralAmountInWad, data);
  }

  function wipeAllUnlockIbBNBAndConvertToBNB(
    address vault,
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 positionId,
    uint256 collateralAmount, // [wad]
    bytes calldata data
  ) public {
    wipeAllAndUnlockToken(manager, tokenAdapter, stablecoinAdapter, positionId, collateralAmount, data);
    ibBNBToBNB(vault, collateralAmount);
  }

  function wipeAllUnlockTokenAndConvert(
    address vault,
    address manager,
    address tokenAdapter,
    address stablecoinAdapter,
    uint256 positionId,
    uint256 collateralAmount, // [in token decimal]
    bytes calldata data
  ) public {
    wipeAllAndUnlockToken(manager, tokenAdapter, stablecoinAdapter, positionId, collateralAmount, data);
    ibTokenToToken(vault, convertTo18(tokenAdapter, collateralAmount));
  }
}
