// SPDX-License-Identifier: AGPL-3.0-or-later
/**
  ∩~~~~∩ 
  ξ ･×･ ξ 
  ξ　~　ξ 
  ξ　　 ξ 
  ξ　　 “~～~～〇 
  ξ　　　　　　 ξ 
  ξ ξ ξ~～~ξ ξ ξ 
　 ξ_ξξ_ξ　ξ_ξξ_ξ
Alpaca Fin Corporation
*/

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

import "../../interfaces/IBookKeeper.sol";
import "../../interfaces/IPriceFeed.sol";
import "../../interfaces/IPriceOracle.sol";
import "../../interfaces/ILiquidationEngine.sol";
import "../../interfaces/ILiquidationStrategy.sol";
import "../../interfaces/ISystemDebtEngine.sol";
import "../../interfaces/IFlashLendingCallee.sol";
import "../../interfaces/IGenericTokenAdapter.sol";
import "../../interfaces/IManager.sol";

contract FixedSpreadLiquidationStrategy is PausableUpgradeable, ReentrancyGuardUpgradeable, ILiquidationStrategy {
  using SafeMathUpgradeable for uint256;

  struct LiquidationInfo {
    uint256 positionDebtShare; // [wad]
    uint256 positionCollateralAmount; // [wad]
    uint256 debtShareToBeLiquidated; // [wad]
    uint256 maxDebtShareToBeLiquidated; // [wad]
    uint256 actualDebtValueToBeLiquidated; // [rad]
    uint256 actualDebtShareToBeLiquidated; // [wad]
    uint256 collateralAmountToBeLiquidated; // [wad]
    uint256 treasuryFees; // [wad]
    uint256 maxLiquidatableDebtShare; // [wad]
  }

  struct LocalVars {
    uint256 debtAccumulatedRate; // [ray]
    uint256 closeFactorBps;
    uint256 liquidatorIncentiveBps;
    uint256 debtFloor; // [rad]
    uint256 treasuryFeesBps;
  }

  // --- Data ---
  IBookKeeper public bookKeeper; // Core CDP Engine
  ILiquidationEngine public liquidationEngine; // Liquidation module
  ISystemDebtEngine public systemDebtEngine; // Recipient of AUSD raised in auctions
  IPriceOracle public priceOracle; // Collateral price module

  uint256 public flashLendingEnabled;

  /// @param _positionCollateralAmount [wad]
  /// @param _debtShareToBeLiquidated [wad]
  /// @param _maxDebtShareToBeLiquidated [wad]
  /// @param _actualDebtShareToBeLiquidated [wad]
  /// @param _actualDebtValueToBeLiquidated [rad]
  /// @param _collateralAmountToBeLiquidated [wad]
  /// @param _treasuryFees [wad]
  event LogFixedSpreadLiquidate(
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

  event LogSetFlashLendingEnabled(address indexed caller, uint256 _flashLendingEnabled);

  modifier onlyOwnerOrGov() {
    IAccessControlConfig _accessControlConfig = IAccessControlConfig(IBookKeeper(bookKeeper).accessControlConfig());
    require(
      _accessControlConfig.hasRole(_accessControlConfig.OWNER_ROLE(), msg.sender) ||
        _accessControlConfig.hasRole(_accessControlConfig.GOV_ROLE(), msg.sender),
      "!(ownerRole or govRole)"
    );
    _;
  }

  // --- Init ---
  function initialize(
    address _bookKeeper,
    address _priceOracle,
    address _liquidationEngine,
    address _systemDebtEngine
  ) external initializer {
    PausableUpgradeable.__Pausable_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    IBookKeeper(_bookKeeper).totalStablecoinIssued(); // Sanity Check Call
    bookKeeper = IBookKeeper(_bookKeeper);

    IPriceOracle(_priceOracle).stableCoinReferencePrice(); // Sanity Check Call
    priceOracle = IPriceOracle(_priceOracle);

    ILiquidationEngine(_liquidationEngine).live(); // Sanity Check Call
    liquidationEngine = ILiquidationEngine(_liquidationEngine);

    ISystemDebtEngine(_systemDebtEngine).surplusBuffer(); // Sanity Check Call
    systemDebtEngine = ISystemDebtEngine(_systemDebtEngine);
  }

  // --- Math ---
  uint256 constant BLN = 10**9;
  uint256 constant WAD = 10**18;
  uint256 constant RAY = 10**27;

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x);
  }

  function rdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y > 0, "FixedSpreadLiquidationStrategy/zero-divisor");
    z = mul(x, RAY) / y;
  }

  // --- Setter ---
  /// @dev access: OWNER_ROLE, GOV_ROLE
  function setFlashLendingEnabled(uint256 _flashLendingEnabled) external onlyOwnerOrGov {
    flashLendingEnabled = _flashLendingEnabled;
    emit LogSetFlashLendingEnabled(msg.sender, _flashLendingEnabled);
  }

  // get the price directly from the PriceOracle
  function getFeedPrice(bytes32 collateralPoolId) internal view returns (uint256 feedPrice) {
    address _priceFeedAddress = ICollateralPoolConfig(bookKeeper.collateralPoolConfig()).getPriceFeed(collateralPoolId);
    IPriceFeed _priceFeed = IPriceFeed(_priceFeedAddress);
    (bytes32 price, bool priceOk) = _priceFeed.peekPrice();
    require(priceOk, "FixedSpreadLiquidationStrategy/invalid-price");
    // (price [wad] * BLN [10 ** 9] ) [ray] / priceOracle.stableCoinReferencePrice [ray]
    feedPrice = rdiv(mul(uint256(price), BLN), priceOracle.stableCoinReferencePrice()); // [ray]
  }

  function _calculateLiquidationInfo(
    bytes32 _collateralPoolId,
    uint256 /*_debtShareToBeLiquidated*/,
    uint256 _currentCollateralPrice,
    uint256 _positionCollateralAmount,
    uint256 _positionDebtShare
  ) internal view returns (LiquidationInfo memory info) {
    LocalVars memory _vars;
    _vars.debtAccumulatedRate = ICollateralPoolConfig(bookKeeper.collateralPoolConfig()).getDebtAccumulatedRate(
      _collateralPoolId
    ); // [ray]
    _vars.closeFactorBps = ICollateralPoolConfig(bookKeeper.collateralPoolConfig()).getCloseFactorBps(
      _collateralPoolId
    );
    _vars.liquidatorIncentiveBps = ICollateralPoolConfig(bookKeeper.collateralPoolConfig()).getLiquidatorIncentiveBps(
      _collateralPoolId
    );
    _vars.debtFloor = ICollateralPoolConfig(bookKeeper.collateralPoolConfig()).getDebtFloor(_collateralPoolId); // [rad]
    _vars.treasuryFeesBps = ICollateralPoolConfig(bookKeeper.collateralPoolConfig()).getTreasuryFeesBps(
      _collateralPoolId
    );

    // full liquidation
    info.maxLiquidatableDebtShare = _positionDebtShare; // [wad]

    info.actualDebtShareToBeLiquidated = _positionDebtShare; // [wad]
    
    // actualDebtShareToBeLiquidated [wad] * _debtAccumulatedRate [ray]
    info.actualDebtValueToBeLiquidated = info.actualDebtShareToBeLiquidated.mul(_vars.debtAccumulatedRate); // [rad]

    // Calculate the collateral amount to be liquidated with 50 bps buffer
    // ( actualDebtValueToBeLiquidated [rad]  / _currentCollateralPrice [ray]
    uint256 _intendCollatAmountToBeLiquidaed = info.actualDebtValueToBeLiquidated.mul(10150).div(10000).div(_currentCollateralPrice); // [wad]

    info.collateralAmountToBeLiquidated = _intendCollatAmountToBeLiquidaed > _positionCollateralAmount
      ? _positionCollateralAmount
      : _intendCollatAmountToBeLiquidaed; // [wad]

    info.treasuryFees = 0; // [wad]
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
  ) external override nonReentrant whenNotPaused {
    require(
      IAccessControlConfig(bookKeeper.accessControlConfig()).hasRole(keccak256("LIQUIDATION_ENGINE_ROLE"), msg.sender),
      "!liquidationEngingRole"
    );

    // Input validation
    require(_positionDebtShare > 0, "FixedSpreadLiquidationStrategy/zero-debt");
    require(_positionCollateralAmount > 0, "FixedSpreadLiquidationStrategy/zero-collateral-amount");
    require(_positionAddress != address(0), "FixedSpreadLiquidationStrategy/zero-position-address");

    // 1. Get current collateral price from Oracle
    uint256 _currentCollateralPrice = getFeedPrice(_collateralPoolId); // [ray]
    require(_currentCollateralPrice > 0, "FixedSpreadLiquidationStrategy/zero-collateral-price");

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
      info.collateralAmountToBeLiquidated < 2**255 && info.actualDebtShareToBeLiquidated < 2**255,
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
    IGenericTokenAdapter _adapter = IGenericTokenAdapter(
      ICollateralPoolConfig(bookKeeper.collateralPoolConfig()).getAdapter(_collateralPoolId)
    );
    _adapter.onMoveCollateral(_positionAddress, address(this), info.collateralAmountToBeLiquidated, abi.encode(0));

    // 5. Give the collateral to the collateralRecipient
    bookKeeper.moveCollateral(
      _collateralPoolId,
      address(this),
      _collateralRecipient,
      info.collateralAmountToBeLiquidated.sub(info.treasuryFees)
    );
    _adapter.onMoveCollateral(
      address(this),
      _collateralRecipient,
      info.collateralAmountToBeLiquidated.sub(info.treasuryFees),
      abi.encode(0)
    );

    // 6. Give the treasury fees to System Debt Engine to be stored as system surplus
    if (info.treasuryFees > 0) {
      bookKeeper.moveCollateral(_collateralPoolId, address(this), address(systemDebtEngine), info.treasuryFees);
      _adapter.onMoveCollateral(address(this), address(systemDebtEngine), info.treasuryFees, abi.encode(0));
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
        info.actualDebtValueToBeLiquidated,
        info.collateralAmountToBeLiquidated.sub(info.treasuryFees),
        _data
      );
    }

    // Get Alpaca Stablecoin from the liquidator for debt repayment
    bookKeeper.moveStablecoin(_liquidatorAddress, address(systemDebtEngine), info.actualDebtValueToBeLiquidated);

    info.positionDebtShare = _positionDebtShare;
    info.positionCollateralAmount = _positionCollateralAmount;
    info.debtShareToBeLiquidated = _debtShareToBeLiquidated;
    info.maxDebtShareToBeLiquidated = _maxDebtShareToBeLiquidated;
    emit LogFixedSpreadLiquidate(
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

  // --- pause ---
  /// @dev access: OWNER_ROLE, GOV_ROLE
  function pause() external onlyOwnerOrGov {
    _pause();
  }

  /// @dev access: OWNER_ROLE, GOV_ROLE
  function unpause() external onlyOwnerOrGov {
    _unpause();
  }
}
