pragma solidity 0.6.12;

import "../interfaces/IAuthTokenAdapter.sol";

interface IStableSwapModule {
  function swapTokenForStablecoin(address usr, uint256 tokenAmount) external;

  function swapStablecoinToToken(address usr, uint256 tokenAmount) external;

  function authTokenAdapter() external view returns (IAuthTokenAdapter);
}
