pragma solidity 0.6.12;

interface ISurplusAuctioneer {
  function startAuction(uint256 lot, uint256 bid) external returns (uint256);

  function cage(uint256) external;

  function live() external returns (uint256);
}
