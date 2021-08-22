pragma solidity 0.6.12;

import "../interfaces/IToken.sol";

interface IAdapter {
  function rely(address usr) external;

  function deny(address usr) external;

  function cage() external;

  function decimals() external returns (uint256);

  function isFarmable() external returns (bool);

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

  function collateralPoolId() external view returns (bytes32);

  function collateralToken() external returns (IToken);
}
