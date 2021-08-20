pragma solidity 0.6.12;

interface IFarmableTokenAdapter {
  function deposit(
    address,
    address,
    uint256
  ) external;

  function moveRewards(
    address,
    address,
    uint256
  ) external;

  function collateralPoolId() external view returns (bytes32);
}
