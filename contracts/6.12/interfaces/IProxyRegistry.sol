pragma solidity 0.6.12;

interface IProxyRegistry {
  function proxies(address) external view returns (address);

  function build(address) external returns (address);
}
