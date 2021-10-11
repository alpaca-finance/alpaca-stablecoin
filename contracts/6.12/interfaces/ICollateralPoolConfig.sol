pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./IPriceFeed.sol";
import "./IGenericTokenAdapter.sol";
import "./ILiquidationStrategy.sol";

interface ICollateralPoolConfig {
  struct CollateralPool {
    uint256 totalDebtShare; // Total debt share of Alpaca Stablecoin of this collateral pool              [wad]
    uint256 debtAccumulatedRate; // Accumulated rates (equivalent to ibToken Price)                       [ray]
    uint256 priceWithSafetyMargin; // Price with safety margin (taken into account the Collateral Ratio)  [ray]
    uint256 debtCeiling; // Debt ceiling of this collateral pool                                          [rad]
    uint256 debtFloor; // Position debt floor of this collateral pool                                     [rad]
    address priceFeed; // Price Feed
    uint256 liquidationRatio; // Liquidation ratio or Collateral ratio                                    [ray]
    uint256 stabilityFeeRate; // Collateral-specific, per-second stability fee debtAccumulatedRate or mint interest debtAccumulatedRate [ray]
    uint256 lastAccumulationTime; // Time of last call to `collect`                                       [unix epoch time]
    address adapter;
    uint256 closeFactorBps; // Percentage (BPS) of how much  of debt could be liquidated in a single liquidation
    uint256 liquidatorIncentiveBps; // Percentage (BPS) of how much additional collateral will be given to the liquidator incentive
    uint256 treasuryFeesBps; // Percentage (BPS) of how much additional collateral will be transferred to the treasury
    address strategy; // Liquidation strategy for this collateral pool
  }

  function setPriceWithSafetyMargin(bytes32 collateralPoolId, uint256 priceWithSafetyMargin) external;

  function collateralPools(bytes32 _collateralPoolId) external view returns (CollateralPool memory);

  function setTotalDebtShare(bytes32 _collateralPoolId, uint256 _totalDebtShare) external;

  function setDebtAccumulatedRate(bytes32 _collateralPoolId, uint256 _debtAccumulatedRate) external;

  function updateLastAccumulationTime(bytes32 _collateralPoolId) external;
}
