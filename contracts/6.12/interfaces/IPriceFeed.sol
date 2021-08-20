pragma solidity 0.6.12;

interface IPriceFeed {
  function read() external view returns (bytes32);

  function peek() external returns (bytes32, bool);
}
