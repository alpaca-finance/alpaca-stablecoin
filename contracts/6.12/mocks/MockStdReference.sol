pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/IPriceFeed.sol";
import "../interfaces/IStdReference.sol";

contract MockStdReference is IStdReference {
  function getReferenceData(string memory _base, string memory _quote)
    external
    view
    override
    returns (IStdReference.ReferenceData memory data)
  {
    data.rate = 0;
    data.lastUpdatedBase = 0;
    data.lastUpdatedQuote = 0;
  }

  function getReferenceDataBulk(string[] memory _bases, string[] memory _quotes)
    external
    view
    override
    returns (IStdReference.ReferenceData[] memory arr)
  {
    return arr;
  }
}
