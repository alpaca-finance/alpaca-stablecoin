// SPDX-License-Identifier: MIT
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

interface IVault {
  /// @dev Return the total ERC20 entitled to the token holders. Be careful of unaccrued interests.
  function totalToken() external view returns (uint256);

  /// @dev Return the total supply of this IB Token.
  function totalSupply() external view returns (uint256);
}
