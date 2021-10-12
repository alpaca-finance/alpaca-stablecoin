pragma solidity 0.6.12;

interface ICagable {
  event LogCage();
  event LogUncage();

  function cage() external;

  function uncage() external;
}
