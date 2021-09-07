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

  function cage() external;

  function stableCoinReferencePrice() external view returns (uint256);

  function setStableCoinReferencePrice(uint256) external;

  function setPriceFeed(bytes32, address) external;

  function setLiquidationRatio(bytes32, uint256) external;
}
