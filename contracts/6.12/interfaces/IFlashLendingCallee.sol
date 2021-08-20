pragma solidity 0.6.12;

interface IFlashLendingCallee {
  function flashLendingCall(
    address,
    uint256,
    uint256,
    bytes calldata
  ) external;
}
