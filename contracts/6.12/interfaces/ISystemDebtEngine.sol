pragma solidity 0.6.12;

interface ISystemDebtEngine {
  function pushToBadDebtQueue(uint256) external;

  function cage() external;
}
