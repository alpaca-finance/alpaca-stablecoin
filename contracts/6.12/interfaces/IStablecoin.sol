pragma solidity 0.6.12;

import "./IToken.sol";

interface IStablecoin is IToken {
  function mint(address, uint256) external;

  function burn(address, uint256) external;
}
