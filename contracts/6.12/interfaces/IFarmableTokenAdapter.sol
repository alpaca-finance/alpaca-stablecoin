pragma solidity 0.6.12;

import "../interfaces/IGenericTokenAdapter.sol";

interface IFarmableTokenAdapter is IGenericTokenAdapter {
  function moveStake(
    address,
    address,
    uint256,
    bytes calldata
  ) external;
}
