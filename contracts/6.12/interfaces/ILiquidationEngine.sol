pragma solidity 0.6.12;

import "../interfaces/ICagable.sol";

interface ILiquidationEngine is ICagable {
  function strategies(bytes32) external returns (address);
}
