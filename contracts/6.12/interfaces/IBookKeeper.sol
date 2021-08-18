pragma solidity 0.6.12;

interface IBookKeeper {
  function collateralToken(bytes32, address) external view returns (uint256);

  function addCollateral(
    bytes32,
    address,
    int256
  ) external;

  function movePosition(
    bytes32,
    address,
    address,
    int256,
    int256
  ) external;

  function can(address, address) external view returns (uint256);

  function adjustPosition(
    bytes32,
    address,
    address,
    address,
    int256,
    int256
  ) external;

  function confiscate(
    bytes32,
    address,
    address,
    address,
    int256,
    int256
  ) external;

  function file(
    bytes32,
    bytes32,
    uint256
  ) external;

  function stablecoin(address) external view returns (uint256);

  function positions(bytes32 collateralPoolId, address urn)
    external
    view
    returns (
      uint256 lockedCollateral, // [wad]
      uint256 debtShare // [wad]
    );

  function debt() external returns (uint256);

  function moveStablecoin(
    address src,
    address dst,
    uint256 rad
  ) external;

  function moveCollateral(
    bytes32 collateralPoolId,
    address src,
    address dst,
    uint256 rad
  ) external;

  function grab(
    bytes32 i,
    address u,
    address v,
    address w,
    int256 dink,
    int256 dart
  ) external;

  function mintUnbackedStablecoin(
    address u,
    address v,
    uint256 rad
  ) external;

  function cage() external;

  function collateralPools(bytes32)
    external
    view
    returns (
      uint256,
      uint256,
      uint256,
      uint256,
      uint256
    );

  function accrueStabilityFee(
    bytes32,
    address,
    int256
  ) external;

  function dai(address) external view returns (uint256);

  function systemBadDebt(address) external view returns (uint256);

  function settleSystemBadDebt(uint256) external;

  function hope(address) external;

  function nope(address) external;
}
