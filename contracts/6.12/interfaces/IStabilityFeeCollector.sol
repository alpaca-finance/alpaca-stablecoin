pragma solidity 0.6.12;

interface IStabilityFeeCollector {
  function collect(bytes32 collateralPoolId) external returns (uint256 debtAccumulatedRate); // [ray]
}
