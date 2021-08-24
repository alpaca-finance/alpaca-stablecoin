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

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "../../interfaces/IBookKeeper.sol";
import "../../interfaces/IToken.sol";
import "../../interfaces/IGenericTokenAdapter.sol";

// FIXME: This contract was altered compared to the production version.
// It doesn't use LibNote anymore.
// New deployments of this contract will need to include custom events (TO DO).

/*
    Here we provide *adapters* to connect the BookKeeper to arbitrary external
    token implementations, creating a bounded context for the BookKeeper. The
    adapters here are provided as working examples:

      - `TokenAdapter`: For well behaved ERC20 tokens, with simple transfer
                   semantics.

      - `ETHJoin`: For native Ether.

      - `StablecoinAdapter`: For connecting internal Dai balances to an external
                   `DSToken` implementation.

    In practice, adapter implementations will be varied and specific to
    individual collateral types, accounting for different transfer
    semantics and token standards.

    Adapters need to implement two basic methods:

      - `deposit`: enter collateral into the system
      - `withdraw`: remove collateral from the system

*/

contract TokenAdapter is
  OwnableUpgradeable,
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  IGenericTokenAdapter
{
  // --- Auth ---
  mapping(address => uint256) public wards;

  function rely(address usr) external override auth {
    wards[usr] = 1;
  }

  function deny(address usr) external override auth {
    wards[usr] = 0;
  }

  modifier auth {
    require(wards[msg.sender] == 1, "TokenAdapter/not-authorized");
    _;
  }

  IBookKeeper public bookKeeper; // CDP Engine
  bytes32 public override collateralPoolId; // Collateral Type
  IToken public override collateralToken;
  uint256 public override decimals;
  uint256 public live; // Active Flag
  bool public override isFarmable; // if true `moveRewards` must be called on every movement of collateral

  function initialize(
    address _bookKeeper,
    bytes32 collateralPoolId_,
    address collateralToken_
  ) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    wards[msg.sender] = 1;
    live = 1;
    bookKeeper = IBookKeeper(_bookKeeper);
    collateralPoolId = collateralPoolId_;
    collateralToken = IToken(collateralToken_);
    decimals = collateralToken.decimals();
  }

  function cage() external override auth {
    live = 0;
  }

  function deposit(address usr, uint256 wad, bytes calldata data) external payable override nonReentrant {
    require(live == 1, "TokenAdapter/not-live");
    require(int256(wad) >= 0, "TokenAdapter/overflow");
    bookKeeper.addCollateral(collateralPoolId, usr, int256(wad));
    require(collateralToken.transferFrom(msg.sender, address(this), wad), "TokenAdapter/failed-transfer");
  }

  function withdraw(address usr, uint256 wad, bytes calldata data) external override nonReentrant {
    require(wad <= 2**255, "TokenAdapter/overflow");
    bookKeeper.addCollateral(collateralPoolId, msg.sender, -int256(wad));
    require(collateralToken.transfer(usr, wad), "TokenAdapter/failed-transfer");
  }
}
