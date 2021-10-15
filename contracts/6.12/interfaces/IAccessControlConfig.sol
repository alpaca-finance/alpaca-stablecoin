pragma solidity 0.6.12;

interface IAccessControlConfig {
  function hasRole(bytes32 role, address account) external view returns (bool);

  function OWNER_ROLE() external view returns (bytes32);

  function GOV_ROLE() external view returns (bytes32);

  function PRICE_ORACLE_ROLE() external view returns (bytes32);

  function ADAPTER_ROLE() external view returns (bytes32);

  function LIQUIDATION_ENGINE_ROLE() external view returns (bytes32);

  function STABILITY_FEE_COLLECTOR_ROLE() external view returns (bytes32);

  function SHOW_STOPPER_ROLE() external view returns (bytes32);

  function POSITION_MANAGER_ROLE() external view returns (bytes32);

  function MINTABLE_ROLE() external view returns (bytes32);

  function BOOK_KEEPER_ROLE() external view returns (bytes32);

  function REINVESTOR_ROLE() external view returns (bytes32);
}
