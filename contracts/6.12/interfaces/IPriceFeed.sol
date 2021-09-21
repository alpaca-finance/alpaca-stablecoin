pragma solidity 0.6.12;

interface IPriceFeed {
  function readPrice() external view returns (bytes32);

  function peekPrice() external view returns (bytes32, bool);
}
