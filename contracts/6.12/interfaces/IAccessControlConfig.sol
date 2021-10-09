pragma solidity 0.6.12;

interface IAccessControlConfig {
  function hasRole(bytes32 role, address account) external view returns (bool);
}
