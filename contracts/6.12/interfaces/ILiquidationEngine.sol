pragma solidity 0.6.12;

interface ILiquidationEngine {
  function liquidationPenalty(bytes32) external view returns (uint256);

  function removeRepaidDebtFromAuction(bytes32, uint256) external;

  function collateralPools(bytes32)
    external
    returns (
      address auctioneer,
      uint256 liquidationPenalty,
      uint256 liquidationMaxSize,
      uint256 stablecoinNeededForDebtRepay
    );

  function cage() external;
}
