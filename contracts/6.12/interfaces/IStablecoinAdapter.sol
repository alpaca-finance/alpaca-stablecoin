pragma solidity 0.6.12;

import "../interfaces/IBookKeeper.sol";
import "../interfaces/IStablecoin.sol";

interface IStablecoinAdapter {
  function bookKeeper() external returns (IBookKeeper);

  function stablecoin() external returns (IStablecoin);

  function deposit(address, uint256) external payable;

  function withdraw(address, uint256) external;
}
