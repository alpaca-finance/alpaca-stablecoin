pragma solidity 0.6.12;

import "../interfaces/IToken.sol";

interface IFarmableTokenAdapter {
  function deposit(
    address,
    address,
    uint256
  ) external;

  function withdraw(
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

  function collateralToken() external returns (IToken);
}
