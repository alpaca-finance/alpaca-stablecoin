pragma solidity 0.6.12;

import "../interfaces/IAdapter.sol";

interface IFarmableTokenAdapter is IAdapter {
  function moveRewards(
    address,
    address,
    uint256
  ) external;
}
