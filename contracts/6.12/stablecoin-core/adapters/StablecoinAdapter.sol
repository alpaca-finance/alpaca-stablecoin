// SPDX-License-Identifier: AGPL-3.0-or-later

/// deposit.sol -- Basic token adapters

// Copyright (C) 2018 Rain <rainbreak@riseup.net>
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

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "../../interfaces/IStablecoin.sol";
import "../../interfaces/IBookKeeper.sol";
import "../../interfaces/IToken.sol";
import "../../interfaces/IStablecoinAdapter.sol";
import "../../interfaces/ICagable.sol";

// FIXME: This contract was altered compared to the production version.
// It doesn't use LibNote anymore.
// New deployments of this contract will need to include custom events (TO DO).

/*
    Here we provide *adapters* to connect the BookKeeper to arbitrary external
    token implementations, creating a bounded context for the BookKeeper. The
    adapters here are provided as working examples:

      - `TokenAdapter`: For well behaved ERC20 tokens, with simple transfer
                   semantics.

      - `StablecoinAdapter`: For connecting internal Alpaca Stablecoin balances to an external
                   `AlpacaStablecoin` implementation.

    In practice, adapter implementations will be varied and specific to
    individual collateral types, accounting for different transfer
    semantics and token standards.

    Adapters need to implement two basic methods:

      - `deposit`: enter token into the system
      - `withdraw`: remove token from the system

*/

contract StablecoinAdapter is PausableUpgradeable, ReentrancyGuardUpgradeable, IStablecoinAdapter, ICagable {
  bytes32 public constant OWNER_ROLE = 0x00;

  IBookKeeper public override bookKeeper; // CDP Engine
  IStablecoin public override stablecoin; // Stablecoin Token
  uint256 public live; // Active Flag

  function initialize(address _bookKeeper, address _stablecoin) external initializer {
    PausableUpgradeable.__Pausable_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    live = 1;
    bookKeeper = IBookKeeper(_bookKeeper);
    stablecoin = IStablecoin(_stablecoin);
  }

  function cage() external override {
    require(
      bookKeeper.accessControlConfigHasRole(OWNER_ROLE, msg.sender) ||
        bookKeeper.accessControlConfigHasRole(bookKeeper.accessControlConfig().SHOW_STOPPER_ROLE(), msg.sender),
      "!(ownerRole or showStopperRole)"
    );
    require(live == 1, "StablecoinAdapter/not-live");
    live = 0;
    emit Cage();
  }

  function uncage() external override {
    require(
      bookKeeper.accessControlConfigHasRole(OWNER_ROLE, msg.sender) ||
        bookKeeper.accessControlConfigHasRole(bookKeeper.accessControlConfig().SHOW_STOPPER_ROLE(), msg.sender),
      "!(ownerRole or showStopperRole)"
    );
    require(live == 0, "StablecoinAdapter/not-caged");
    live = 1;
    emit Uncage();
  }

  uint256 constant ONE = 10**27;

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x);
  }

  /// @dev Deposit stablecoin into the system from the caller to be used for debt repayment or liquidation
  /// @param usr The source address which is holding the stablecoin
  /// @param wad The amount of stablecoin to be deposited [wad]
  function deposit(
    address usr,
    uint256 wad,
    bytes calldata /* data */
  ) external payable override nonReentrant {
    bookKeeper.moveStablecoin(address(this), usr, mul(ONE, wad));
    stablecoin.burn(msg.sender, wad);
  }

  /// @dev Withdraw stablecoin from the system to the caller
  /// @param usr The destination address to receive stablecoin
  /// @param wad The amount of stablecoin to be withdrawn [wad]
  function withdraw(
    address usr,
    uint256 wad,
    bytes calldata /* data */
  ) external override nonReentrant {
    require(live == 1, "StablecoinAdapter/not-live");
    bookKeeper.moveStablecoin(msg.sender, address(this), mul(ONE, wad));
    stablecoin.mint(usr, wad);
  }
}
