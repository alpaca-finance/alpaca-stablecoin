pragma solidity 0.6.12;

interface ILiquidationEngine {
  // function liquidationPenalty(bytes32) external view returns (uint256);

  function removeRepaidDebtFromAuction(bytes32, uint256) external;

  function collateralPools(bytes32)
    external
    returns (
      address strategy,
      uint256 closeFactor,
      uint256 liquidatorIncentiveBps,
      uint256 treasuryFeesBps
    );

  function cage() external;
}
