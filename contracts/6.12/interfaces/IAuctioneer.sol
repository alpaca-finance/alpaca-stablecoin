pragma solidity 0.6.12;

interface IAuctioneer {
  function collateralPoolId() external view returns (bytes32);

  function startAuction(
    uint256 debt,
    uint256 collateralAmount,
    address positionAddress,
    address liquidatorAddress
  ) external returns (uint256);

  function sales(uint256 id)
    external
    view
    returns (
      uint256 pos,
      uint256 debt,
      uint256 collateralAmount,
      address positionAddress,
      uint96 auctionStartBlock,
      uint256 startingPrice
    );

  function yank(uint256 id) external;
}
