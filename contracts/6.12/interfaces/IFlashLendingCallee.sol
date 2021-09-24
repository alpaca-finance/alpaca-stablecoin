pragma solidity 0.6.12;

interface IFlashLendingCallee {
  function flashLendingCall(
    address caller,
    uint256 debtValueToRepay, // [rad]
    uint256 collateralAmountToLiquidate, // [wad]
    bytes calldata
  ) external;
}
