pragma solidity 0.6.12;

import "../interfaces/IGenericTokenAdapter.sol";

interface IShowStopper {
  function redeemLockedCollateral(
    bytes32 collateralPoolId,
    IGenericTokenAdapter adapter,
    address positionAddress,
    bytes calldata data
  ) external;
}
