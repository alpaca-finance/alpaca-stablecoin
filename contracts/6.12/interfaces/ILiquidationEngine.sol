pragma solidity 0.6.12;

interface ILiquidationEngine {
  function strategies(bytes32) external returns (address);

  function cage() external;
}
