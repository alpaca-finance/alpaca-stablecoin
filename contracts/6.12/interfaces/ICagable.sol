pragma solidity 0.6.12;

interface ICagable {
  event Cage();
  event Uncage();

  function cage() external;

  function uncage() external;
}
