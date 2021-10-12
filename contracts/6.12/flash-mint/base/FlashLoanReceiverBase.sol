// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021 Dai Foundation
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

pragma solidity 0.6.12;

import "../FlashMintModule.sol";
import "../../interfaces/IBookKeeperFlashBorrower.sol";
import "../../interfaces/IERC3156FlashBorrower.sol";

abstract contract FlashLoanReceiverBase is IBookKeeperFlashBorrower, IERC3156FlashBorrower {
  FlashMintModule public flash;

  bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");
  bytes32 public constant CALLBACK_SUCCESS_BOOK_KEEPER_STABLE_COIN =
    keccak256("BookKeeperFlashBorrower.onBookKeeperFlashLoan");

  // --- Init ---
  constructor(address _flash) public {
    flash = FlashMintModule(_flash);
  }

  // --- Math ---
  uint256 constant RAY = 10**27;

  function rad(uint256 _wad) internal pure returns (uint256) {
    return mul(_wad, RAY);
  }

  function add(uint256 _x, uint256 _y) internal pure returns (uint256 z) {
    require((z = _x + _y) >= _x);
  }

  function mul(uint256 _x, uint256 _y) internal pure returns (uint256 z) {
    require(_y == 0 || (z = _x * _y) / _y == _x);
  }

  // --- Helper Functions ---
  function approvePayback(uint256 _amount) internal {
    // Lender takes back the stablecoin as per ERC 3156 spec
    flash.stablecoin().approve(address(flash), _amount);
  }

  function payBackBookKeeper(uint256 _amount) internal {
    // Lender takes back the stablecoin as per ERC 3156 spec
    flash.bookKeeper().moveStablecoin(address(this), address(flash), _amount);
  }
}
