pragma solidity 0.6.12;

interface IStableSwapModule {
  function swapTokenForStablecoin(address usr, uint256 tokenAmount) external;

  function swapStablecoinToToken(address usr, uint256 tokenAmount) external;
}
