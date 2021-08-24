pragma solidity 0.6.12;

interface IManager {
  function mapPositionHandlerToOwner(address) external view returns (address);

  function cdpCan(
    address,
    uint256,
    address
  ) external view returns (uint256);

  function collateralPools(uint256) external view returns (bytes32);

  function owns(uint256) external view returns (address);

  function positions(uint256) external view returns (address);

  function bookKeeper() external view returns (address);

  function open(bytes32, address) external returns (uint256);

  function give(uint256, address) external;

  function cdpAllow(
    uint256,
    address,
    uint256
  ) external;

  function migrationAllow(address, uint256) external;

  function adjustPosition(
    uint256,
    int256,
    int256,
    address,
    bytes calldata
  ) external;

  function moveCollateral(
    uint256,
    address,
    uint256,
    address,
    bytes calldata
  ) external;

  function moveStablecoin(
    uint256,
    address,
    uint256
  ) external;

  function quit(uint256, address) external;

  function enter(address, uint256) external;

  function shift(uint256, uint256) external;
}
