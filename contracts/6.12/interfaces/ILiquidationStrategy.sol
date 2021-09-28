pragma solidity 0.6.12;

interface ILiquidationStrategy {
  function execute(
    bytes32 collateralPoolId,
    uint256 positionDebtShare, // [wad]
    uint256 positionLockedCollateral, // [wad]
    address positionAddress,
    uint256 debtShareToRepay, // [wad]
    address liquidatorAddress,
    bytes calldata data
  ) external;
}
