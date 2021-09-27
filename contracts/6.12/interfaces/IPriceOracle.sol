pragma solidity 0.6.12;

import "./IPriceFeed.sol";

interface IPriceOracle {
  function collateralPools(bytes32)
    external
    view
    returns (
      IPriceFeed priceFeed,
      uint256 liquidationRatio // [ray]
    );

  function stableCoinReferencePrice() external view returns (uint256);
}
