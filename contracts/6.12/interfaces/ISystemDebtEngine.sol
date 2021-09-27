pragma solidity 0.6.12;

interface ISystemDebtEngine {
  function settleSystemBadDebt(uint256 value) external; // [rad]
}
