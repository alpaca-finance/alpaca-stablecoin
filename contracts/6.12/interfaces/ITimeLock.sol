pragma solidity 0.6.12;

interface ITimeLock {
  function queuedTransactions(bytes32) external view returns (bool);

  function queueTransaction(
    address,
    uint256,
    string memory,
    bytes memory,
    uint256
  ) external;

  function executeTransaction(
    address,
    uint256,
    string memory,
    bytes memory,
    uint256
  ) external payable;

  function delay() external view returns (uint256);

  function admin() external view returns (address);
}
