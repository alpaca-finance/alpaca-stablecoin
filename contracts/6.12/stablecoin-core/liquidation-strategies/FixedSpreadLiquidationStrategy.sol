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
    uint256 positionDebtShare; // [wad]
    uint256 positionCollateralAmount; // [wad]
    uint256 debtShareToBeLiquidated; // [wad]
    uint256 maxDebtShareToBeLiquidated; // [wad]
    uint256 actualDebtValueToBeLiquidated; // [rad]
    uint256 actualDebtShareToBeLiquidated; // [wad]
    uint256 collateralAmountToBeLiquidated; // [wad]
    uint256 treasuryFees; // [wad]
    uint256 maxLiquidatableDebtShare; // [rad]
    uint256 priceWithSafetyMargin; // [ray]
    uint256 debtAccumulatedRate; // [ray]
    uint256 debtFloor; // [rad]
  }

  // --- Data ---
  IBookKeeper public bookKeeper; // Core CDP Engine
  ILiquidationEngine public liquidationEngine; // Liquidation module
  ISystemDebtEngine public systemDebtEngine; // Recipient of dai raised in auctions
  IPriceOracle public priceOracle; // Collateral price module
  IManager public positionManager;

  mapping(bytes32 => CollateralPool) public collateralPools;

  uint256 public flashLendingEnabled;

  /// @param _positionCollateralAmount [wad]
  /// @param _debtShareToBeLiquidated [wad]
  /// @param _maxDebtShareToBeLiquidated [wad]
  /// @param _actualDebtShareToBeLiquidated [wad]
  /// @param _actualDebtValueToBeLiquidated [rad]
  /// @param _collateralAmountToBeLiquidated [wad]
  /// @param _treasuryFees [wad]
  event FixedSpreadLiquidate(
    bytes32 indexed _collateralPoolId,
    uint256 _positionDebtShare,
    uint256 _positionCollateralAmount,
    address indexed _positionAddress,
    uint256 _debtShareToBeLiquidated,
    uint256 _maxDebtShareToBeLiquidated,
    address indexed _liquidatorAddress,
    address _collateralRecipient,
    uint256 _actualDebtShareToBeLiquidated,
    uint256 _actualDebtValueToBeLiquidated,
    uint256 _collateralAmountToBeLiquidated,
    uint256 _treasuryFees
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
    require(_closeFactorBps <= 10000, "FixedSpreadLiquidationStrategy/invalid-close-factor-bps-more");
    require(
      _liquidatorIncentiveBps >= 10000 && _liquidatorIncentiveBps <= 19000,
      "FixedSpreadLiquidationStrategy/invalid-liquidator-incentive-bps"
    );
    require(_treasuryFeesBps <= 2500, "FixedSpreadLiquidationStrategy/invalid-treasury-fees-bps-more");

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
    require(_closeFactorBps <= 10000, "FixedSpreadLiquidationStrategy/invalid-close-factor-bps");
    collateralPools[collateralPoolId].closeFactorBps = _closeFactorBps;
    emit SetCloseFactorBps(msg.sender, collateralPoolId, _closeFactorBps);
  }

  function setLiquidatorIncentiveBps(bytes32 collateralPoolId, uint256 _liquidatorIncentiveBps) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(
      _liquidatorIncentiveBps >= 10000 && _liquidatorIncentiveBps <= 19000,
      "FixedSpreadLiquidationStrategy/invalid-liquidator-incentive-bps"
    );
    collateralPools[collateralPoolId].liquidatorIncentiveBps = _liquidatorIncentiveBps;
    emit SetLiquidatorIncentiveBps(msg.sender, collateralPoolId, _liquidatorIncentiveBps);
  }

  function setTreasuryFeesBps(bytes32 collateralPoolId, uint256 _treasuryFeesBps) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(_treasuryFeesBps <= 2500, "FixedSpreadLiquidationStrategy/invalid-treasury-fees-bps");
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
    (
      ,
      info.debtAccumulatedRate, // [ray]
      info.priceWithSafetyMargin, // [ray]
      ,
      info.debtFloor // [rad]
    ) = bookKeeper.collateralPools(_collateralPoolId);

    uint256 _positionDebtValue = mul(_positionDebtShare, info.debtAccumulatedRate);

    // Calculate max liquidatable debt value based on the close factor
    // (_positionDebtShare [wad] * closeFactorBps [bps]) / 10000
    info.maxLiquidatableDebtShare = div(
      mul(_positionDebtShare, collateralPools[_collateralPoolId].closeFactorBps),
      10000
    ); // [wad]

    // Choose to use the minimum amount between `_debtValueToBeLiquidated` and `_maxLiquidatableDebtShare`
    // to not exceed the close factor
    info.actualDebtShareToBeLiquidated = _debtShareToBeLiquidated > info.maxLiquidatableDebtShare
      ? info.maxLiquidatableDebtShare
      : _debtShareToBeLiquidated; // [wad]
    // actualDebtShareToBeLiquidated [wad] * _debtAccumulatedRate [ray]
    info.actualDebtValueToBeLiquidated = mul(info.actualDebtShareToBeLiquidated, info.debtAccumulatedRate); // [rad]

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
      // If the remaining collateral amount value in stablecoin is smaller than `debtFloor`
      // (_positionCollateralAmount [wad] - _maxCollateralAmountToBeLiquidated [wad]) * _currentCollateralPrice [ray] = [rad]
      mul(sub(_positionCollateralAmount, _maxCollateralAmountToBeLiquidated), _currentCollateralPrice) < info.debtFloor
    ) {
      // Full Collateral Liquidation
      // Take all collateral amount of the position
      info.collateralAmountToBeLiquidated = _positionCollateralAmount;

      // Calculate how much debt value to be liquidated should be
      // based on the entire collateral amount of the position
      // (_currentCollateralPrice [ray] * _positionCollateralAmount [wad]) * 10000 / liquidatorIncentiveBps [bps])
      info.actualDebtValueToBeLiquidated = div(
        mul(mul(_currentCollateralPrice, _positionCollateralAmount), 10000),
        collateralPools[_collateralPoolId].liquidatorIncentiveBps
      ); // [rad]
    } else {
      // If the remaining debt after liquidation is smaller than `debtFloor`
      if (
        _positionDebtValue > info.actualDebtValueToBeLiquidated &&
        sub(_positionDebtValue, info.actualDebtValueToBeLiquidated) < info.debtFloor
      ) {
        // Full Debt Liquidation
        info.actualDebtValueToBeLiquidated = _positionDebtValue; // [rad]
        // actualDebtValueToBeLiquidated [rad] * liquidatorIncentiveBps [bps] / 10000 / _currentCollateralPrice [ray]
        info.collateralAmountToBeLiquidated = div(
          div(
            mul(info.actualDebtValueToBeLiquidated, collateralPools[_collateralPoolId].liquidatorIncentiveBps),
            10000
          ),
          _currentCollateralPrice
        ); // [wad]
      } else {
        // Partial Liquidation
        info.collateralAmountToBeLiquidated = _maxCollateralAmountToBeLiquidated; // [wad]
      }
    }

    info.actualDebtShareToBeLiquidated = div(info.actualDebtValueToBeLiquidated, info.debtAccumulatedRate); // [wad]

    info.treasuryFees = div(
      mul(info.collateralAmountToBeLiquidated, collateralPools[_collateralPoolId].treasuryFeesBps),
      10000
    ); // [wad]
  }

  function execute(
    bytes32 _collateralPoolId,
    uint256 _positionDebtShare, // Debt Value                  [rad]
    uint256 _positionCollateralAmount, // Collateral Amount           [wad]
    address _positionAddress, // Address that will receive any leftover collateral
    uint256 _debtShareToBeLiquidated, // The value of debt to be liquidated as specified by the liquidator [rad]
    uint256 _maxDebtShareToBeLiquidated, // The maximum value of debt to be liquidated as specified by the liquidator in case of full liquidation for slippage control [rad]
    address _liquidatorAddress,
    address _collateralRecipient,
    bytes calldata _data // Data to pass in external call; if length 0, no call is done
  ) external override {
    require(hasRole(LIQUIDATION_ENGINE_ROLE, msg.sender), "!liquidationEngingRole");

    // Input validation
    require(_positionDebtShare > 0, "FixedSpreadLiquidationStrategy/zero-debt");
    require(_positionCollateralAmount > 0, "FixedSpreadLiquidationStrategy/zero-collateralAmount");
    require(_positionAddress != address(0), "FixedSpreadLiquidationStrategy/zero-positionAddress");

    // 1. Get current collateral price from Oracle
    uint256 _currentCollateralPrice = getFeedPrice(_collateralPoolId); // [ray]
    require(_currentCollateralPrice > 0, "FixedSpreadLiquidationStrategy/zero-starting-price");

    // 2.. Calculate collateral amount to be liquidated according to the current price and liquidator incentive
    LiquidationInfo memory info = _calculateLiquidationInfo(
      _collateralPoolId,
      _debtShareToBeLiquidated,
      _currentCollateralPrice,
      _positionCollateralAmount,
      _positionDebtShare
    );

    // 4. Confiscate position
    // Slippage check
    require(
      info.actualDebtShareToBeLiquidated <= _maxDebtShareToBeLiquidated,
      "FixedSpreadLiquidationStrategy/exceed-max-debt-value-to-be-liquidated"
    );
    // Overflow check
    require(
      info.collateralAmountToBeLiquidated <= 2**255 && info.actualDebtShareToBeLiquidated <= 2**255,
      "FixedSpreadLiquidationStrategy/overflow"
    );
    bookKeeper.confiscatePosition(
      _collateralPoolId,
      _positionAddress,
      address(this),
      address(systemDebtEngine),
      -int256(info.collateralAmountToBeLiquidated),
      -int256(info.actualDebtShareToBeLiquidated)
    );
    address _positionOwnerAddress = positionManager.mapPositionHandlerToOwner(_positionAddress);
    if (_positionOwnerAddress == address(0)) _positionOwnerAddress = _positionAddress;
    CollateralPool memory collateralPool = collateralPools[_collateralPoolId];
    collateralPool.adapter.onMoveCollateral(
      _positionAddress,
      address(this),
      info.collateralAmountToBeLiquidated,
      abi.encode(_positionOwnerAddress)
    );

    // 5. Give the collateral to the collateralRecipient
    bookKeeper.moveCollateral(
      _collateralPoolId,
      address(this),
      _collateralRecipient,
      sub(info.collateralAmountToBeLiquidated, info.treasuryFees)
    );
    collateralPool.adapter.onMoveCollateral(
      address(this),
      _collateralRecipient,
      sub(info.collateralAmountToBeLiquidated, info.treasuryFees),
      abi.encode(_positionOwnerAddress)
    );

    // 6. Give the treasury fees to System Debt Engine to be stored as system surplus
    if (info.treasuryFees > 0) {
      bookKeeper.moveCollateral(_collateralPoolId, address(this), address(systemDebtEngine), info.treasuryFees);
      collateralPool.adapter.onMoveCollateral(
        address(this),
        address(systemDebtEngine),
        info.treasuryFees,
        abi.encode(_positionOwnerAddress)
      );
    }

    // 7. Do external call (if data is defined) but to be
    // extremely careful we don't allow to do it to the two
    // contracts which the FixedSpreadLiquidationStrategy needs to be authorized
    if (
      flashLendingEnabled == 1 &&
      _data.length > 0 &&
      _collateralRecipient != address(bookKeeper) &&
      _collateralRecipient != address(liquidationEngine)
    ) {
      IFlashLendingCallee(_collateralRecipient).flashLendingCall(
        msg.sender,
        info.actualDebtShareToBeLiquidated,
        sub(info.collateralAmountToBeLiquidated, info.treasuryFees),
        _data
      );
    }

    // Get Alpaca Stablecoin from the liquidator for debt repayment
    bookKeeper.moveStablecoin(_liquidatorAddress, address(systemDebtEngine), info.actualDebtValueToBeLiquidated);

    info.positionDebtShare = _positionDebtShare;
    info.positionCollateralAmount = _positionCollateralAmount;
    info.debtShareToBeLiquidated = _debtShareToBeLiquidated;
    info.maxDebtShareToBeLiquidated = _maxDebtShareToBeLiquidated;
    emit FixedSpreadLiquidate(
      _collateralPoolId,
      info.positionDebtShare,
      info.positionCollateralAmount,
      _positionAddress,
      info.debtShareToBeLiquidated,
      info.maxDebtShareToBeLiquidated,
      _liquidatorAddress,
      _collateralRecipient,
      info.actualDebtShareToBeLiquidated,
      info.actualDebtValueToBeLiquidated,
      info.collateralAmountToBeLiquidated,
      info.treasuryFees
    );
  }
}
