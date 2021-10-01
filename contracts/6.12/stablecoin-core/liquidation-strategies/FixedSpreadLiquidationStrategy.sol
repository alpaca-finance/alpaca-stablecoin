// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "../../interfaces/IBookKeeper.sol";
import "../../interfaces/IAuctioneer.sol";
import "../../interfaces/IPriceFeed.sol";
import "../../interfaces/IPriceOracle.sol";
import "../../interfaces/ILiquidationEngine.sol";
import "../../interfaces/ILiquidationStrategy.sol";
import "../../interfaces/ISystemDebtEngine.sol";
import "../../interfaces/IFlashLendingCallee.sol";
import "../../interfaces/IGenericTokenAdapter.sol";
import "../../interfaces/IManager.sol";

contract FixedSpreadLiquidationStrategy is
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  ILiquidationStrategy
{
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;
  bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");
  bytes32 public constant LIQUIDATION_ENGINE_ROLE = keccak256("LIQUIDATION_ENGINE_ROLE");

  struct CollateralPool {
    IGenericTokenAdapter adapter;
    uint256 closeFactorBps; // Percentage (BPS) of how much  of debt could be liquidated in a single liquidation
    uint256 liquidatorIncentiveBps; // Percentage (BPS) of how much additional collateral will be given to the liquidator incentive
    uint256 treasuryFeesBps; // Percentage (BPS) of how much additional collateral will be transferred to the treasury
  }

  struct LiquidationInfo {
    uint256 actualDebtValueToBeLiquidated; // [rad]
    uint256 actualDebtShareToBeLiquidated; // [wad]
    uint256 collateralAmountToBeLiquidated; // [wad]
    uint256 treasuryFees; // [wad]
    uint256 maxLiquidatableDebtShare; // [rad]
  }

  // --- Data ---
  IBookKeeper public bookKeeper; // Core CDP Engine
  ILiquidationEngine public liquidationEngine; // Liquidation module
  ISystemDebtEngine public systemDebtEngine; // Recipient of dai raised in auctions
  IPriceOracle public priceOracle; // Collateral price module
  IManager public positionManager;

  mapping(bytes32 => CollateralPool) public collateralPools;

  uint256 public flashLendingEnabled;

  /// @param debtValueToRepay [rad]
  /// @param collateralAmountToLiquidate [wad]
  /// @param liquidatorIncentiveFees [wad]
  /// @param treasuryFees [wad]
  event FixedSpreadLiquidate(
    bytes32 indexed collateralPoolId,
    uint256 debtValueToRepay,
    uint256 collateralAmountToLiquidate,
    uint256 liquidatorIncentiveFees,
    uint256 treasuryFees,
    address indexed positionAddress,
    address indexed liquidatorAddress,
    address collateralRecipient
  );
  event SetCollateralPool(
    address indexed caller,
    bytes32 collateralPoolId,
    address _adapter,
    uint256 _closeFactorBps,
    uint256 _liquidatorIncentiveBps,
    uint256 _treasuryFeeBps
  );
  event SetAdapter(address indexed caller, bytes32 collateralPoolId, address _adapter);
  event SetCloseFactorBps(address indexed caller, bytes32 collateralPoolId, uint256 _closeFactorBps);
  event SetLiquidatorIncentiveBps(address indexed caller, bytes32 collateralPoolId, uint256 _liquidatorIncentiveBps);
  event SetTreasuryFeesBps(address indexed caller, bytes32 collateralPoolId, uint256 _treasuryFeeBps);
  event SetPositionManager(address indexed caller, address _positionManager);
  event SetFlashLendingEnabled(address indexed caller, uint256 _flashLendingEnabled);

  // --- Init ---
  function initialize(
    address _bookKeeper,
    address _priceOracle,
    address _liquidationEngine,
    address _systemDebtEngine,
    address _positionManager
  ) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    bookKeeper = IBookKeeper(_bookKeeper);
    priceOracle = IPriceOracle(_priceOracle);
    liquidationEngine = ILiquidationEngine(_liquidationEngine);
    systemDebtEngine = ISystemDebtEngine(_systemDebtEngine);
    positionManager = IManager(_positionManager);

    // Grant the contract deployer the default admin role: it will be able
    // to grant and revoke any roles
    _setupRole(OWNER_ROLE, msg.sender);
  }

  // --- Math ---
  uint256 constant BLN = 10**9;
  uint256 constant WAD = 10**18;
  uint256 constant RAY = 10**27;

  function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = x <= y ? x : y;
  }

  function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x + y) >= x);
  }

  function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x - y) <= x);
  }

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x);
  }

  function wmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = mul(x, y) / WAD;
  }

  function rmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = mul(x, y) / RAY;
  }

  function rdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y > 0, "FixedSpreadLiquidationStrategy/zero-divisor");
    z = mul(x, RAY) / y;
  }

  function wdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y > 0, "FixedSpreadLiquidationStrategy/zero-divisor");
    z = mul(x, WAD) / y;
  }

  function div(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y > 0, "FixedSpreadLiquidationStrategy/zero-divisor");
    z = x / y;
  }

  // --- Setter ---
  function setCollateralPool(
    bytes32 collateralPoolId,
    address _adapter,
    uint256 _closeFactorBps,
    uint256 _liquidatorIncentiveBps,
    uint256 _treasuryFeesBps
  ) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(_closeFactorBps <= 10000, "FixedSpreadLiquidationStrategy/close-factor-bps-more-10000");
    require(_liquidatorIncentiveBps >= 10000, "FixedSpreadLiquidationStrategy/liquidator-incentive-bps-more-2500");
    require(_treasuryFeesBps <= 2500, "FixedSpreadLiquidationStrategy/treasury-fees-bps-more-2500");

    collateralPools[collateralPoolId].adapter = IGenericTokenAdapter(_adapter);
    collateralPools[collateralPoolId].closeFactorBps = _closeFactorBps;
    collateralPools[collateralPoolId].liquidatorIncentiveBps = _liquidatorIncentiveBps;
    collateralPools[collateralPoolId].treasuryFeesBps = _treasuryFeesBps;

    emit SetCollateralPool(
      msg.sender,
      collateralPoolId,
      _adapter,
      _closeFactorBps,
      _liquidatorIncentiveBps,
      _treasuryFeesBps
    );
  }

  function setAdapter(bytes32 collateralPoolId, address _adapter) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    collateralPools[collateralPoolId].adapter = IGenericTokenAdapter(_adapter);
    emit SetAdapter(msg.sender, collateralPoolId, _adapter);
  }

  function setCloseFactorBps(bytes32 collateralPoolId, uint256 _closeFactorBps) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(_closeFactorBps <= 10000, "FixedSpreadLiquidationStrategy/close-factor-bps-more-10000");
    collateralPools[collateralPoolId].closeFactorBps = _closeFactorBps;
    emit SetCloseFactorBps(msg.sender, collateralPoolId, _closeFactorBps);
  }

  function setLiquidatorIncentiveBps(bytes32 collateralPoolId, uint256 _liquidatorIncentiveBps) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(_liquidatorIncentiveBps >= 10000, "FixedSpreadLiquidationStrategy/liquidator-incentive-bps-more-2500");
    collateralPools[collateralPoolId].liquidatorIncentiveBps = _liquidatorIncentiveBps;
    emit SetLiquidatorIncentiveBps(msg.sender, collateralPoolId, _liquidatorIncentiveBps);
  }

  function setTreasuryFeesBps(bytes32 collateralPoolId, uint256 _treasuryFeesBps) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(_treasuryFeesBps <= 2500, "FixedSpreadLiquidationStrategy/treasury-fees-bps-more-2500");
    collateralPools[collateralPoolId].treasuryFeesBps = _treasuryFeesBps;
    emit SetTreasuryFeesBps(msg.sender, collateralPoolId, _treasuryFeesBps);
  }

  function setPositionManager(address _positionManager) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    positionManager = IManager(_positionManager);
    emit SetPositionManager(msg.sender, _positionManager);
  }

  function setFlashLendingEnabled(uint256 _flashLendingEnabled) external {
    require(hasRole(OWNER_ROLE, msg.sender) || hasRole(GOV_ROLE, msg.sender), "!(ownerRole or govRole)");
    flashLendingEnabled = _flashLendingEnabled;
    emit SetFlashLendingEnabled(msg.sender, _flashLendingEnabled);
  }

  // --- Auction ---

  // get the price directly from the PriceOracle
  // Could get this from rmul(BookKeeper.collateralPools(collateralPoolId).spot, Spotter.mat()) instead, but
  // if mat has changed since the last poke, the resulting value will be
  // incorrect.
  function getFeedPrice(bytes32 collateralPoolId) internal view returns (uint256 feedPrice) {
    (IPriceFeed priceFeed, ) = priceOracle.collateralPools(collateralPoolId);
    (bytes32 price, bool priceOk) = priceFeed.peekPrice();
    require(priceOk, "FixedSpreadLiquidationStrategy/invalid-price");
    // (price [wad] * BLN [10 ** 9] ) [ray] / priceOracle.stableCoinReferencePrice [ray]
    feedPrice = rdiv(mul(uint256(price), BLN), priceOracle.stableCoinReferencePrice()); // [ray]
  }

  function _calculateLiquidationInfo(
    bytes32 _collateralPoolId,
    uint256 _debtShareToBeLiquidated,
    uint256 _currentCollateralPrice,
    uint256 _positionCollateralAmount,
    uint256 _positionDebtShare
  ) internal view returns (LiquidationInfo memory info) {
    (, uint256 _debtAccumulatedRate, , , uint256 debtFloor) = bookKeeper.collateralPools(_collateralPoolId);
    uint256 _positionDebtValue = mul(_positionDebtShare, _debtAccumulatedRate);

    // Calculate max liquidatable debt value based on the close factor
    // (_positionDebtShare [wad] * closeFactorBps [bps]) / 10000
    info.maxLiquidatableDebtShare = div(
      mul(_positionDebtShare, collateralPools[_collateralPoolId].closeFactorBps),
      10000
    ); // [rad]

    // Choose to use the minimum amount between `_debtValueToBeLiquidated` and `_maxLiquidatableDebtShare`
    // to not exceed the close factor
    info.actualDebtShareToBeLiquidated = _debtShareToBeLiquidated > info.maxLiquidatableDebtShare
      ? info.maxLiquidatableDebtShare
      : _debtShareToBeLiquidated; // [rad]
    info.actualDebtValueToBeLiquidated = mul(info.actualDebtShareToBeLiquidated, _debtAccumulatedRate);

    // Calculate the max collateral amount to be liquidated by taking all the fees into account
    // ( actualDebtValueToBeLiquidated [rad] * liquidatorIncentiveBps [bps] / 10000 / _currentCollateralPrice [ray]
    uint256 _maxCollateralAmountToBeLiquidated = div(
      div(mul(info.actualDebtValueToBeLiquidated, collateralPools[_collateralPoolId].liquidatorIncentiveBps), 10000),
      _currentCollateralPrice
    ); // [wad]

    // If the calculated collateral amount to be liquidated exceeds the position collateral amount,
    // then we need to recalculate the debt value to be liquidated that would be enough to liquidate the position entirely
    // Or if the remaining collateral or the remaining debt is very small and smaller than `debtFloor`, we will force full collateral liquidation
    if (
      // If the max collateral amount (including liquidator incentive) that should be liquidated exceeds the total collateral amount of that position
      _maxCollateralAmountToBeLiquidated > _positionCollateralAmount ||
      // If the remaining debt after liquidation is smaller than `debtFloor`
      (_positionDebtValue > info.actualDebtValueToBeLiquidated &&
        sub(_positionDebtValue, info.actualDebtValueToBeLiquidated) < debtFloor) ||
      // If the remaining collateral amount value in stablecoin is smaller than `debtFloor`
      mul(sub(_positionCollateralAmount, _maxCollateralAmountToBeLiquidated), _currentCollateralPrice) < debtFloor
    ) {
      // Full Collateral Liquidation

      // Take all collateral amount of the position
      info.collateralAmountToBeLiquidated = _positionCollateralAmount;

      // Calculate how much debt value to be liquidated should be
      // based on the entire collateral amount of the position
      // (_currentCollateralPrice [ray] * _positionCollateralAmount [wad]) * 10000 / (liquidatorIncentiveBps [bps] + treasuryFeesBps [bps])
      info.actualDebtValueToBeLiquidated = div(
        mul(mul(_currentCollateralPrice, _positionCollateralAmount), 10000),
        collateralPools[_collateralPoolId].liquidatorIncentiveBps
      ); // [rad]
    } else {
      // Partial Collateral Liquidation
      info.collateralAmountToBeLiquidated = _maxCollateralAmountToBeLiquidated; // [wad]
    }

    info.actualDebtShareToBeLiquidated = div(info.actualDebtValueToBeLiquidated, _debtAccumulatedRate);

    info.treasuryFees = div(
      mul(info.collateralAmountToBeLiquidated, collateralPools[_collateralPoolId].treasuryFeesBps),
      10000
    );
  }

  function execute(
    bytes32 collateralPoolId,
    uint256 positionDebtShare, // Debt Value                  [rad]
    uint256 positionCollateralAmount, // Collateral Amount           [wad]
    address positionAddress, // Address that will receive any leftover collateral
    uint256 debtShareToBeLiquidated, // The value of debt to be liquidated as specified by the liquidator [rad]
    uint256 maxDebtShareToBeLiquidated, // The maximum value of debt to be liquidated as specified by the liquidator in case of full liquidation for slippage control [rad]
    address _liquidatorAddress,
    address collateralRecipient,
    bytes calldata data // Data to pass in external call; if length 0, no call is done
  ) external override {
    require(hasRole(LIQUIDATION_ENGINE_ROLE, msg.sender), "!liquidationEngingRole");

    // Input validation
    require(positionDebtShare > 0, "FixedSpreadLiquidationStrategy/zero-debt");
    require(positionCollateralAmount > 0, "FixedSpreadLiquidationStrategy/zero-collateralAmount");
    require(positionAddress != address(0), "FixedSpreadLiquidationStrategy/zero-positionAddress");

    // 1. Get current collateral price from Oracle
    uint256 currentCollateralPrice = getFeedPrice(collateralPoolId); // [ray]
    require(currentCollateralPrice > 0, "FixedSpreadLiquidationStrategy/zero-starting-price");

    // 2.. Calculate collateral amount to be liquidated according to the current price and liquidator incentive
    LiquidationInfo memory info = _calculateLiquidationInfo(
      collateralPoolId,
      debtShareToBeLiquidated,
      currentCollateralPrice,
      positionCollateralAmount,
      positionDebtShare
    );

    // 4. Confiscate position
    // Slippage check
    require(
      info.actualDebtShareToBeLiquidated <= maxDebtShareToBeLiquidated,
      "FixedSpreadLiquidationStrategy/exceed-max-debt-value-to-be-liquidated"
    );
    // Overflow check
    require(
      info.collateralAmountToBeLiquidated <= 2**255 && info.actualDebtShareToBeLiquidated <= 2**255,
      "FixedSpreadLiquidationStrategy/overflow"
    );
    bookKeeper.confiscatePosition(
      collateralPoolId,
      positionAddress,
      address(this),
      address(systemDebtEngine),
      -int256(info.collateralAmountToBeLiquidated),
      -int256(info.actualDebtShareToBeLiquidated)
    );
    address positionOwnerAddress = positionManager.mapPositionHandlerToOwner(positionAddress);
    if (positionOwnerAddress == address(0)) positionOwnerAddress = positionAddress;
    CollateralPool memory collateralPool = collateralPools[collateralPoolId];
    collateralPool.adapter.onMoveCollateral(
      positionAddress,
      address(this),
      info.collateralAmountToBeLiquidated,
      abi.encode(positionOwnerAddress)
    );

    // 5. Give the collateral to the collateralRecipient
    bookKeeper.moveCollateral(
      collateralPoolId,
      address(this),
      collateralRecipient,
      sub(info.collateralAmountToBeLiquidated, info.treasuryFees)
    );
    collateralPool.adapter.onMoveCollateral(
      address(this),
      collateralRecipient,
      sub(info.collateralAmountToBeLiquidated, info.treasuryFees),
      abi.encode(positionOwnerAddress)
    );

    // 6. Give the treasury fees to System Debt Engine to be stored as system surplus
    if (info.treasuryFees > 0) {
      bookKeeper.moveCollateral(collateralPoolId, address(this), address(systemDebtEngine), info.treasuryFees);
      collateralPool.adapter.onMoveCollateral(
        address(this),
        address(systemDebtEngine),
        info.treasuryFees,
        abi.encode(positionOwnerAddress)
      );
    }

    // 7. Do external call (if data is defined) but to be
    // extremely careful we don't allow to do it to the two
    // contracts which the FixedSpreadLiquidationStrategy needs to be authorized
    if (
      flashLendingEnabled == 1 &&
      data.length > 0 &&
      collateralRecipient != address(bookKeeper) &&
      collateralRecipient != address(liquidationEngine)
    ) {
      IFlashLendingCallee(collateralRecipient).flashLendingCall(
        msg.sender,
        info.actualDebtShareToBeLiquidated,
        sub(info.collateralAmountToBeLiquidated, info.treasuryFees),
        data
      );
    }

    // Get Alpaca Stablecoin from the liquidator for debt repayment
    bookKeeper.moveStablecoin(_liquidatorAddress, address(systemDebtEngine), info.actualDebtValueToBeLiquidated);

    // emit FixedSpreadLiquidate(
    //   collateralPoolId,
    //   info.debtValueToRepay,
    //   info.collateralAmountToLiquidate,
    //   info.liquidatorIncentiveFees,
    //   info.treasuryFees,
    //   positionAddress,
    //   liquidatorAddress,
    //   collateralRecipient
    // );
  }
}
