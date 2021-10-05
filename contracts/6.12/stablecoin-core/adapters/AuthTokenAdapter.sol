// SPDX-License-Identifier: AGPL-3.0-or-later

/// AuthTokenAdapter.sol -- Non-standard token adapters

// Copyright (C) 2018 Rain <rainbreak@riseup.net>
// Copyright (C) 2018-2020 Maker Ecosystem Growth Holdings, INC.
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
import "../../interfaces/IAuthTokenAdapter.sol";
import "../../interfaces/ICagable.sol";

// Authed TokenAdapter for a token that has a lower precision than 18 and it has decimals (like USDC)

contract AuthTokenAdapter is
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  IAuthTokenAdapter,
  ICagable
{
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;
  bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");
  bytes32 public constant SHOW_STOPPER_ROLE = keccak256("SHOW_STOPPER_ROLE");
  bytes32 public constant WHITELISTED = keccak256("WHITELISTED");

  IBookKeeper public override bookKeeper; // cdp engine
  bytes32 public override collateralPoolId; // collateral pool id
  IToken public override token; // collateral token
  uint256 public override decimals; // collateralToken decimals
  uint256 public live; // Access Flag

  // --- Events ---
  event Rely(address indexed usr);
  event Deny(address indexed usr);
  event Deposit(address indexed urn, uint256 wad, address indexed msgSender);
  event Withdraw(address indexed guy, uint256 wad);

  function initialize(
    address bookKeeper_,
    bytes32 collateralPoolId_,
    address token_
  ) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    token = IToken(token_);
    decimals = IToken(token_).decimals();
    live = 1;
    bookKeeper = IBookKeeper(bookKeeper_);
    collateralPoolId = collateralPoolId_;

    // Grant the contract deployer the owner role: it will be able
    // to grant and revoke any roles
    _setupRole(OWNER_ROLE, msg.sender);
  }

  function cage() external override {
    require(
      hasRole(OWNER_ROLE, msg.sender) || hasRole(SHOW_STOPPER_ROLE, msg.sender),
      "!(ownerRole or showStopperRole)"
    );
    require(live == 1, "AuthTokenAdapter/not-live");
    live = 0;
    emit Cage();
  }

  function uncage() external override {
    require(
      hasRole(OWNER_ROLE, msg.sender) || hasRole(SHOW_STOPPER_ROLE, msg.sender),
      "!(ownerRole or showStopperRole)"
    );
    require(live == 0, "AuthTokenAdapter/not-caged");
    live = 1;
    emit Uncage();
  }

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x, "AuthTokenAdapter/overflow");
  }

  /**
   * @dev Deposit token into the system from the msgSender to be used as collateral
   * @param urn The destination address which is holding the collateral token
   * @param wad The amount of collateral to be deposit [wad]
   * @param msgSender The source address which transfer token
   */
  function deposit(
    address urn,
    uint256 wad,
    address msgSender
  ) external override nonReentrant {
    require(hasRole(WHITELISTED, msg.sender), "AuthTokenAdapter/not-whitelisted");
    require(live == 1, "AuthTokenAdapter/not-live");
    uint256 wad18 = mul(wad, 10**(18 - decimals));
    require(int256(wad18) >= 0, "AuthTokenAdapter/overflow");
    bookKeeper.addCollateral(collateralPoolId, urn, int256(wad18));
    require(token.transferFrom(msgSender, address(this), wad), "AuthTokenAdapter/failed-transfer");
    emit Deposit(urn, wad, msgSender);
  }

  /**
   * @dev Withdraw token from the system to guy
   * @param guy The destination address to receive collateral token
   * @param wad The amount of collateral to be withdraw [wad]
   */
  function withdraw(address guy, uint256 wad) external override nonReentrant {
    uint256 wad18 = mul(wad, 10**(18 - decimals));
    require(int256(wad18) >= 0, "AuthTokenAdapter/overflow");
    bookKeeper.addCollateral(collateralPoolId, msg.sender, -int256(wad18));
    require(token.transfer(guy, wad), "AuthTokenAdapter/failed-transfer");
    emit Withdraw(guy, wad);
  }

  // --- pause ---
  function pause() external {
    require(hasRole(OWNER_ROLE, msg.sender) || hasRole(GOV_ROLE, msg.sender), "!(ownerRole or govRole)");
    _pause();
  }

  function unpause() external {
    require(hasRole(OWNER_ROLE, msg.sender) || hasRole(GOV_ROLE, msg.sender), "!(ownerRole or govRole)");
    _unpause();
  }
}
