pragma solidity 0.6.12;

import "./IPriceFeed.sol";

interface IPriceOracle {
  function stableCoinReferencePrice() external view returns (uint256);
}
