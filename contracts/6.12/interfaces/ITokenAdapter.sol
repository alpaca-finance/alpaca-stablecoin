pragma solidity 0.6.12;

import "../interfaces/IToken.sol";

interface ITokenAdapter {
  function decimals() external returns (uint256);

  function collateralToken() external returns (IToken);

  function deposit(address, uint256) external payable;

  function withdraw(address, uint256) external;
}
