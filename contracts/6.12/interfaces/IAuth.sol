pragma solidity 0.6.12;

interface IAuthority {
  function canCall(
    address src,
    address dst,
    bytes4 sig
  ) external view returns (bool);
}
