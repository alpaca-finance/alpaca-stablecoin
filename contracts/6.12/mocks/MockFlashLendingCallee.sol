pragma solidity 0.6.12;

import "../interfaces/IFlashLendingCallee.sol";

contract MockFlashLendingCallee is IFlashLendingCallee {
  function flashLendingCall(
    address,
    uint256,
    uint256,
    bytes calldata
  ) external override {}
}
