pragma solidity 0.6.12;

import "../interfaces/IToken.sol";

interface IGenericTokenAdapter {
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

  function onAdjustPosition(
    address src,
    address dst,
    int256 collateralValue,
    int256 debtShare,
    bytes calldata data
  ) external;

  function onMoveCollateral(
    address src,
    address dst,
    uint256 wad,
    bytes calldata data
  ) external;

  function collateralPoolId() external view returns (bytes32);

  function collateralToken() external returns (IToken);
}
