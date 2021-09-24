pragma solidity 0.6.12;

import "../interfaces/IBookKeeper.sol";
import "../interfaces/IStablecoin.sol";
import "../interfaces/ICagable.sol";

interface IStablecoinAdapter is ICagable {
  function bookKeeper() external returns (IBookKeeper);

  function stablecoin() external returns (IStablecoin);

  function deposit(
    address positionAddress,
    uint256 wad,
    bytes calldata data
  ) external payable;

  function withdraw(
    address positionAddress,
    uint256 wad,
    bytes calldata data
  ) external;
}
