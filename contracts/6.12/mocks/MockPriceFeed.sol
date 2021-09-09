pragma solidity 0.6.12;

import "../interfaces/IPriceFeed.sol";

contract MockPriceFeed is IPriceFeed {
  function read() external view override returns (bytes32) {
    return 0;
  }

  function peek() external view override returns (bytes32, bool) {
    return (0, true);
  }
}
