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

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

import "../interfaces/IAlpacaOracle.sol";
import "../interfaces/IAlpacaVault.sol";

contract VaultPriceOracle is Initializable, IAlpacaOracle {
  using SafeMathUpgradeable for uint256;
  mapping(address => bool) public vaults;

  function initialize() external initializer {}

  event LogSetVault(address indexed _vault, bool _isOk);

  /// @dev Return the wad price of token0/token1, multiplied by 1e18
  /// NOTE: (if you have 1 token0 how much you can sell it for token1)
  function getPrice(address token0, address token1) external view override returns (uint256, uint256) {
    if (vaults[token0] && IAlpacaVault(token0).token() == token1) {
      return (IAlpacaVault(token0).totalToken().mul(1e18).div(IAlpacaVault(token0).totalSupply()), uint64(now));
    }
    if (vaults[token1] && IAlpacaVault(token1).token() == token0) {
      return (IAlpacaVault(token1).totalSupply().mul(1e18).div(IAlpacaVault(token1).totalToken()), uint64(now));
    }
    return (0, 0);
  }

  function setVault(address _vault, bool _isOk) external {
    if (_isOk) {
      // sanity check
      IAlpacaVault(_vault).totalToken();
    }
    vaults[_vault] = _isOk;

    emit LogSetVault(_vault, _isOk);
  }
}
