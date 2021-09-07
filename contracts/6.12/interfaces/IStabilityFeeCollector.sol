pragma solidity 0.6.12;

interface IStabilityFeeCollector {
  function collect(bytes32) external returns (uint256);

  function setGlobalStabilityFeeRate(uint256) external;

  function setSystemDebtEngine(address) external;

  function setStabilityFeeRate(bytes32, uint256) external;
}
