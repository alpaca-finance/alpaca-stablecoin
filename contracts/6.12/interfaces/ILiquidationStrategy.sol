pragma solidity 0.6.12;

interface ILiquidationStrategy {
  function execute(
    bytes32,
    uint256,
    uint256,
    address,
    address,
    uint256,
    address,
    bytes calldata
  ) external;
}
