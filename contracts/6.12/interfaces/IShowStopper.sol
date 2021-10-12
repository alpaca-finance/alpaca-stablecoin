pragma solidity 0.6.12;

import "../interfaces/IGenericTokenAdapter.sol";

interface IShowStopper {
  function redeemLockedCollateral(
    bytes32 collateralPoolId,
    IGenericTokenAdapter adapter,
    address positionAddress,
    address collateralReceiver,
    bytes calldata data
  ) external;

  function live() external view returns (uint256);
}
