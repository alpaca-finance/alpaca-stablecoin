// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "../../interfaces/IBookKeeper.sol";
import "../../interfaces/IAuctioneer.sol";
import "../../interfaces/IPriceFeed.sol";
import "../../interfaces/IPriceOracle.sol";
import "../../interfaces/ILiquidationEngine.sol";
import "../../interfaces/ILiquidationStrategy.sol";
import "../../interfaces/IFlashLendingCallee.sol";

contract FixedSpreadLiquidationStrategy is
  OwnableUpgradeable,
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  ILiquidationStrategy
{
  struct CollateralPool {
    uint256 closeFactorBps; // Percentage (BPS) of how much  of debt could be liquidated in a single liquidation [wad]
    uint256 liquidatorIncentiveBps; // Percentage (BPS) of how much additional collateral will be given to the liquidator incentive
    uint256 treasuryFeesBps; // Percentage (BPS) of how much additional collateral will be transferred to the treasury
  }

  struct LiquidationInfo {
    uint256 debtValueToRepay;
    uint256 collateralAmountToLiquidate;
    uint256 liquidatorIncentiveFees;
    uint256 treasuryFees;
    uint256 collateralAmountToLiquidateWithAllFees;
  }

  // --- Data ---
  IBookKeeper public bookKeeper; // Core CDP Engine
  ILiquidationEngine public liquidationEngine; // Liquidation module
  address public systemDebtEngine; // Recipient of dai raised in auctions
  IPriceOracle public priceOracle; // Collateral price module
  mapping(bytes32 => CollateralPool) public collateralPools;

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

  // --- Init ---
  function initialize(
    address _bookKeeper,
    address priceOracle_,
    address liquidationEngine_,
    bytes32 collateralPoolId_
  ) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    bookKeeper = IBookKeeper(_bookKeeper);
    priceOracle = IPriceOracle(priceOracle_);
    liquidationEngine = ILiquidationEngine(liquidationEngine_);
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
    z = mul(x, RAY) / y;
  }

  function wdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = mul(x, WAD) / y;
  }

  // --- Auction ---

  // get the price directly from the OSM
  // Could get this from rmul(BookKeeper.collateralPools(collateralPoolId).spot, Spotter.mat()) instead, but
  // if mat has changed since the last poke, the resulting value will be
  // incorrect.
  function getFeedPrice(bytes32 collateralPoolId) internal returns (uint256 feedPrice) {
    (IPriceFeed priceFeed, ) = priceOracle.collateralPools(collateralPoolId);
    (bytes32 val, bool has) = priceFeed.peek();
    require(has, "FixedSpreadLiquidationStrategy/invalid-price");
    feedPrice = rdiv(mul(uint256(val), BLN), priceOracle.stableCoinReferencePrice());
  }

  function calculateLiquidationInfo(
    bytes32 collateralPoolId,
    uint256 debtShareToRepay,
    uint256 currentCollateralPrice,
    uint256 positionCollateralAmount
  ) internal returns (LiquidationInfo memory info) {
    (, uint256 debtAccumulatedRate, , , ) = bookKeeper.collateralPools(collateralPoolId);
    info.debtValueToRepay = mul(debtShareToRepay, debtAccumulatedRate);
    info.collateralAmountToLiquidate = wdiv(info.debtValueToRepay, currentCollateralPrice);
    info.liquidatorIncentiveFees = wdiv(
      mul(info.collateralAmountToLiquidate, collateralPools[collateralPoolId].liquidatorIncentiveBps),
      10000
    );
    info.treasuryFees = wdiv(
      mul(info.collateralAmountToLiquidate, collateralPools[collateralPoolId].treasuryFeesBps),
      10000
    );
    info.collateralAmountToLiquidateWithAllFees = add(
      add(info.collateralAmountToLiquidate, info.liquidatorIncentiveFees),
      info.treasuryFees
    );

    require(
      info.collateralAmountToLiquidateWithAllFees <= positionCollateralAmount,
      "FixedSpreadLiquidationStrategy/liquidate-too-much"
    );
  }

  function execute(
    bytes32 collateralPoolId,
    uint256 positionDebtShare, // Debt                   [rad]
    uint256 positionCollateralAmount, // Collateral             [wad]
    address positionAddress, // Address that will receive any leftover collateral
    address liquidatorAddress, // Address that will receive incentives
    uint256 debtShareToRepay, // [wad]
    address collateralRecipient, // Receiver of collateral and external call address
    bytes calldata data // Data to pass in external call; if length 0, no call is done
  ) external override {
    // Input validation
    require(positionDebtShare > 0, "FixedSpreadLiquidationStrategy/zero-debt");
    require(positionCollateralAmount > 0, "FixedSpreadLiquidationStrategy/zero-collateralAmount");
    require(positionAddress != address(0), "FixedSpreadLiquidationStrategy/zero-positionAddress");

    // 1. Check if Close Factor is not exceeded
    CollateralPool memory collateralPool = collateralPools[collateralPoolId];
    require(
      collateralPool.closeFactorBps > 0 &&
        wdiv(mul(positionDebtShare, collateralPool.closeFactorBps), 10000) >= debtShareToRepay
    );

    // 2. Get current collateral price from Oracle
    uint256 currentCollateralPrice = getFeedPrice(collateralPoolId);
    require(currentCollateralPrice > 0, "FixedSpreadLiquidationStrategy/zero-starting-price");

    // 3. Calculate collateral amount to be liquidated according to the current price and liquidator incentive
    LiquidationInfo memory info = calculateLiquidationInfo(
      collateralPoolId,
      debtShareToRepay,
      currentCollateralPrice,
      positionCollateralAmount
    );

    // 4. Confiscate position
    bookKeeper.confiscatePosition(
      collateralPoolId,
      positionAddress,
      address(this),
      address(systemDebtEngine),
      -int256(info.collateralAmountToLiquidateWithAllFees),
      -int256(debtShareToRepay)
    );

    // 5. Give the collateral to the collateralRecipient
    bookKeeper.moveCollateral(
      collateralPoolId,
      address(this),
      collateralRecipient,
      add(info.collateralAmountToLiquidate, info.liquidatorIncentiveFees)
    );

    // 6. Give the treasury fees to System Debt Engine to be stored as system surplus
    bookKeeper.moveCollateral(collateralPoolId, address(this), systemDebtEngine, info.treasuryFees);

    // 7. Do external call (if data is defined) but to be
    // extremely careful we don't allow to do it to the two
    // contracts which the FixedSpreadLiquidationStrategy needs to be authorized
    if (
      data.length > 0 && collateralRecipient != address(bookKeeper) && collateralRecipient != address(liquidationEngine)
    ) {
      IFlashLendingCallee(collateralRecipient).flashLendingCall(
        msg.sender,
        info.debtValueToRepay,
        add(info.collateralAmountToLiquidate, info.liquidatorIncentiveFees),
        data
      );
    }

    // 8. Get Alpaca Stablecoin from the liquidator for debt repayment
    bookKeeper.moveStablecoin(msg.sender, systemDebtEngine, info.debtValueToRepay);

    emit FixedSpreadLiquidate(
      collateralPoolId,
      info.debtValueToRepay,
      info.collateralAmountToLiquidate,
      info.liquidatorIncentiveFees,
      info.treasuryFees,
      positionAddress,
      liquidatorAddress,
      collateralRecipient
    );
  }
}
