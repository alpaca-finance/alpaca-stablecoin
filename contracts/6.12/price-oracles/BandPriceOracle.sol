// SPDX-License-Identifier: AGPL-3.0-or-later
/**
  ∩~~~~∩
  ξ ･×･ ξ
  ξ　~　ξ
  ξ　　 ξ
  ξ　　 “~～~～〇
  ξ　　　　　　 ξ
  ξ ξ ξ~～~ξ ξ ξ
　 ξ_ξξ_ξ　ξ_ξξ_ξ
Alpaca Fin Corporation
*/

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "../interfaces/IAlpacaOracle.sol";
import "../interfaces/IStdReference.sol";
import "../interfaces/IAccessControlConfig.sol";

contract BandPriceOracle is IAlpacaOracle, Initializable {
  IStdReference public stdReferenceProxy;
  IAccessControlConfig public accessControlConfig;

  // map between token address and its symbol
  // note that, we're going to treat "USD" as address "0xfff...fff"
  mapping(address => string) public tokenSymbols;

  struct PriceData {
    uint192 price;
    uint64 lastUpdate;
  }

  function initialize(address _stdReferenceProxy) external initializer {
    stdReferenceProxy = IStdReference(_stdReferenceProxy);

    // sanity check
    stdReferenceProxy.getReferenceData("BUSD", "USD");
  }

  modifier onlyOwner() {
    require(accessControlConfig.hasRole(accessControlConfig.OWNER_ROLE(), msg.sender), "!ownerRole");
    _;
  }

  event LogSetTokenSymbol(address indexed _tokenAddress, string _tokenSymbol);

  function setTokenSymbol(address _tokenAddress, string memory _tokenSymbol) external onlyOwner {
    tokenSymbols[_tokenAddress] = _tokenSymbol;
    emit LogSetTokenSymbol(_tokenAddress, _tokenSymbol);
  }

  /// @dev Return the wad price of token0/token1, multiplied by 1e18
  /// NOTE: (if you have 1 token0 how much you can sell it for token1)
  function getPrice(address token0, address token1) external view override returns (uint256, uint256) {
    // solhint-disable not-rely-on-time
    if (token0 == token1) return (1e18, now);

    IStdReference.ReferenceData memory priceData = stdReferenceProxy.getReferenceData(
      tokenSymbols[token0],
      tokenSymbols[token1]
    );

    // find min lasteUpdate
    uint256 lastUpdate = priceData.lastUpdatedBase < priceData.lastUpdatedQuote
      ? priceData.lastUpdatedBase
      : priceData.lastUpdatedQuote;

    return (priceData.rate, lastUpdate);
  }
}
