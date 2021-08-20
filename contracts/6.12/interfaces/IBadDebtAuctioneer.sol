pragma solidity 0.6.12;

interface IBadDebtAuctioneer {
  function startAuction(
    address gal,
    uint256 lot,
    uint256 bid
  ) external returns (uint256);

  function cage() external;

  function live() external returns (uint256);
}
