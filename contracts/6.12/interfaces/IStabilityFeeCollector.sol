pragma solidity 0.6.12;

interface IStabilityFeeCollector {
  function collect(bytes32) external returns (uint256);
}
