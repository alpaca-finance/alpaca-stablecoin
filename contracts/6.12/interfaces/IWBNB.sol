pragma solidity 0.6.12;

interface IWBNB {
  function deposit() external payable;

  function withdraw(uint256) external;
}
