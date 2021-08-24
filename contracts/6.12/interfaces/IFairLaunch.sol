pragma solidity 0.6.12;

interface IFairLaunch {
  function deposit(
    address,
    uint256,
    uint256
  ) external;

  function withdraw(
    address,
    uint256,
    uint256
  ) external;

  function emergencyWithdraw(uint256) external;

  function owner() external view returns (address);

  function alpaca() external view returns (address);

  function poolInfo(uint256)
    external
    view
    returns (
      address,
      uint256,
      uint256,
      uint256,
      uint256
    );
}
