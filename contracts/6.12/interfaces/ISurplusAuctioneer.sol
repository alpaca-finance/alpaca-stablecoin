pragma solidity 0.6.12;

import "../interfaces/ICagable.sol";

interface ISurplusAuctioneer is ICagable {
  function startAuction(uint256 lot, uint256 bid) external returns (uint256);

  function live() external returns (uint256);
}
