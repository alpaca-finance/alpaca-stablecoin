pragma solidity 0.6.12;

import "../interfaces/ICagable.sol";

interface ISystemDebtEngine is ICagable {
  function settleSystemBadDebt(uint256 value) external; // [rad]
}
