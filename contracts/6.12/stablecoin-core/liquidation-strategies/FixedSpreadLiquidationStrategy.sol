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
import "../../interfaces/ICalculator.sol";
import "../../interfaces/IFlashLendingCallee.sol";

contract FixedSpreadLiquidationStrategy is
  OwnableUpgradeable,
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable
{
  struct CollateralPool {
    uint256 closeFactorBps; // Percentage (BPS) of how much  of debt could be liquidated in a single liquidation [wad]
    uint256 liquidatorIncentiveBps; // Percentage (BPS) of how much additional collateral will be given to the liquidator incentive
    uint256 treasuryFeesBps; // Percentage (BPS) of how much additional collateral will be transferred to the treasury
  }

  // --- Data ---
  IBookKeeper public bookKeeper; // Core CDP Engine
  ILiquidationEngine public liquidationEngine; // Liquidation module
  address public systemDebtEngine; // Recipient of dai raised in auctions
  IPriceOracle public priceOracle; // Collateral price module
  mapping(bytes32 => CollateralPool) public override collateralPools;

  event FixedSpreadLiquidate(
    bytes32 indexed collateralPoolId,
    uint256 positionDebtShare,
    uint256 positionCollateralAmount,
    address indexed positionAddress,
    address indexed liquidatorAddress,
    uint256 debtShareToRepay,
    address indexed collateralRecipient
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
    require(has, "CollateralAuctioneer/invalid-price");
    feedPrice = rdiv(mul(uint256(val), BLN), priceOracle.stableCoinReferencePrice());
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
  ) external returns (uint256 id) {
    // Input validation
    require(positionDebtShare > 0, "CollateralAuctioneer/zero-debt");
    require(positionCollateralAmount > 0, "CollateralAuctioneer/zero-collateralAmount");
    require(positionAddress != address(0), "CollateralAuctioneer/zero-positionAddress");

    // 1. Check if Close Factor is not exceeded
    CollateralPool memory collateralPool = collateralPools[collateralPoolId];
    require(
      collateralPool.closeFactor > 0 &&
        wdiv(mul(positionDebtShare, collateralPool.closeFactorBps), 10000) >= debtShareToRepay
    );

    // 2. Get current collateral price from Oracle
    uint256 currentCollateralPrice = getFeedPrice(collateralPoolId);
    require(currentCollateralPrice > 0, "CollateralAuctioneer/zero-starting-price");

    // 3. Calculate collateral amount to be liquidated according to the current price and liquidator incentive
    (, uint256 debtAccumulatedRate, , , uint256 debtFloor) = bookKeeper.collateralPools(collateralPoolId);
    uint256 debtValueToRepay = mul(debtShareToRepay, debtAccumulatedRate);
    uint256 collateralAmountToBeLiquidatedWithoutIncentive = wdiv(debtValueToRepay, currentCollateralPrice);
    uint256 liquidatorIncentiveFees = wdiv(
      mul(collateralAmountToBeLiquidatedWithoutIncentive, collateralPool.liquidatorIncentiveBps),
      10000
    );
    uint256 treasuryFees = wdiv(mul(collateralAmountToBeLiquidatedWithoutIncentive, collateralPool.treasuryFeesBps), 10000);

    uint256 collateralAmountToBeLiquidatedWithIncentive = add(
      add(collateralAmountToBeLiquidatedWithoutIncentive, liquidatorIncentiveFees),
      treasuryFees
    );

    // 4. Confiscate position and give the collateral to the `collateralRecipient` address
    bookKeeper.confiscatePosition(
      collateralPoolId,
      positionAddress,
      address(this),
      address(systemDebtEngine),
      -int256(collateralAmountToBeLiquidatedWithIncentive),
      -int256(debtShareToRepay)
    );

    bookKeeper.moveCollateral(
      collateralPoolId,
      address(this),
      collateralRecipient,
      collateralAmountToBeLiquidatedWithIncentive
    );

    // 5. Do external call (if data is defined) but to be
    // extremely careful we don't allow to do it to the two
    // contracts which the CollateralAuctioneer needs to be authorized
    ILiquidationEngine liquidationEngine_ = liquidationEngine;
    if (
      data.length > 0 &&
      collateralRecipient != address(bookKeeper) &&
      collateralRecipient != address(liquidationEngine_)
    ) {
      IFlashLendingCallee(collateralRecipient).flashLendingCall(
        msg.sender,
        debtValueToRepay,
        collateralAmountToBeLiquidatedWithIncentive,
        data
      );
    }

    // 6. Get Alpaca Stablecoin from the liquidator for debt repayment
    bookKeeper.moveStablecoin(msg.sender, systemDebtEngine, debtValueToRepay);

    emit FixedSpreadLiquidate(
      collateralPoolId,
      debtValueToRepay,
      collateralAmountToBeLiquidatedWithIncentive,
      positionAddress,
      liquidatorAddress,
      collateralRecipient
    );
  }
}
