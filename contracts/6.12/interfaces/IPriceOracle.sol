pragma solidity 0.6.12;

import "./IPriceFeed.sol";
import "../interfaces/ICagable.sol";

interface IPriceOracle is ICagable {
  function collateralPools(bytes32)
    external
    view
    returns (
      IPriceFeed priceFeed,
      uint256 liquidationRatio // [ray]
    );

  function stableCoinReferencePrice() external view returns (uint256);
}
