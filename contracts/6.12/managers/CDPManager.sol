// SPDX-License-Identifier: AGPL-3.0-or-later

/// DssCdpManager.sol

// Copyright (C) 2018-2020 Maker Ecosystem Growth Holdings, INC.

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
import "./PositionHandler.sol";

contract CDPManager is OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable {
  address public government;
  uint256 public cdpi; // Auto incremental
  mapping(uint256 => address) public positions; // CDPId => PositionHandler
  mapping(uint256 => List) public list; // CDPId => Prev & Next CDPIds (double linked list)
  mapping(uint256 => address) public owns; // CDPId => Owner
  mapping(address => address) public mapPositionHandlerToOwner; // PositionHandler => Owner
  mapping(uint256 => bytes32) public collateralPools; // CDPId => Ilk

  mapping(address => uint256) public first; // Owner => First CDPId
  mapping(address => uint256) public last; // Owner => Last CDPId
  mapping(address => uint256) public count; // Owner => Amount of CDPs

  mapping(address => mapping(uint256 => mapping(address => uint256))) public cdpCan; // Owner => CDPId => Allowed Addr => True/False

  mapping(address => mapping(address => uint256)) public positionCan; // Urn => Allowed Addr => True/False

  struct List {
    uint256 prev;
    uint256 next;
  }

  event NewCdp(address indexed usr, address indexed own, uint256 indexed cdp);

  modifier cdpAllowed(uint256 cdp) {
    require(msg.sender == owns[cdp] || cdpCan[owns[cdp]][cdp][msg.sender] == 1, "cdp-not-allowed");
    _;
  }

  modifier positionAllowed(address positionAddress) {
    require(msg.sender == positionAddress || positionCan[positionAddress][msg.sender] == 1, "urn-not-allowed");
    _;
  }

  function initialize(address government_) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    government = government_;
  }

  function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x + y) >= x);
  }

  function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x - y) <= x);
  }

  function toInt(uint256 x) internal pure returns (int256 y) {
    y = int256(x);
    require(y >= 0);
  }

  // Allow/disallow a usr address to manage the cdp.
  function cdpAllow(
    uint256 cdp,
    address usr,
    uint256 ok
  ) public cdpAllowed(cdp) {
    cdpCan[owns[cdp]][cdp][usr] = ok;
  }

  // Allow/disallow a usr address to quit to the the sender urn.
  function urnAllow(address usr, uint256 ok) public {
    positionCan[msg.sender][usr] = ok;
  }

  // Open a new cdp for a given usr address.
  function open(bytes32 collateralPoolId, address usr) public returns (uint256) {
    require(usr != address(0), "usr-address-0");

    cdpi = add(cdpi, 1);
    positions[cdpi] = address(new PositionHandler(government));
    owns[cdpi] = usr;
    ownerMapByPositionHandler[positions[cdpi]] = usr;
    collateralPools[cdpi] = collateralPoolId;

    // Add new CDP to double linked list and pointers
    if (first[usr] == 0) {
      first[usr] = cdpi;
    }
    if (last[usr] != 0) {
      list[cdpi].prev = last[usr];
      list[last[usr]].next = cdpi;
    }
    last[usr] = cdpi;
    count[usr] = add(count[usr], 1);

    emit NewCdp(msg.sender, usr, cdpi);
    return cdpi;
  }

  // Give the cdp ownership to a dst address.
  function give(uint256 cdp, address dst) public cdpAllowed(cdp) {
    require(dst != address(0), "dst-address-0");
    require(dst != owns[cdp], "dst-already-owner");

    // Remove transferred CDP from double linked list of origin user and pointers
    if (list[cdp].prev != 0) {
      list[list[cdp].prev].next = list[cdp].next; // Set the next pointer of the prev cdp (if exists) to the next of the transferred one
    }
    if (list[cdp].next != 0) {
      // If wasn't the last one
      list[list[cdp].next].prev = list[cdp].prev; // Set the prev pointer of the next cdp to the prev of the transferred one
    } else {
      // If was the last one
      last[owns[cdp]] = list[cdp].prev; // Update last pointer of the owner
    }
    if (first[owns[cdp]] == cdp) {
      // If was the first one
      first[owns[cdp]] = list[cdp].next; // Update first pointer of the owner
    }
    count[owns[cdp]] = sub(count[owns[cdp]], 1);

    // Transfer ownership
    owns[cdp] = dst;
    ownerMapByPositionHandler[positions[cdp]] = dst;

    // Add transferred CDP to double linked list of destiny user and pointers
    list[cdp].prev = last[dst];
    list[cdp].next = 0;
    if (last[dst] != 0) {
      list[last[dst]].next = cdp;
    }
    if (first[dst] == 0) {
      first[dst] = cdp;
    }
    last[dst] = cdp;
    count[dst] = add(count[dst], 1);
  }

  // Frob the cdp keeping the generated DAI or collateral freed in the cdp urn address.
  function adjustPosition(
    uint256 cdp,
    int256 collateralValue,
    int256 debtShare
  ) public cdpAllowed(cdp) {
    address positionAddress = positions[cdp];
    GovernmentLike(government).adjustPosition(
      collateralPools[cdp],
      positionAddress,
      positionAddress,
      positionAddress,
      collateralValue,
      debtShare
    );
  }

  // Transfer wad amount of cdp collateral from the cdp address to a dst address.
  function moveCollateral(
    uint256 cdp,
    address dst,
    uint256 wad
  ) public cdpAllowed(cdp) {
    GovernmentLike(government).moveCollateral(collateralPools[cdp], positions[cdp], dst, wad);
  }

  // Transfer wad amount of any type of collateral (collateralPoolId) from the cdp address to a dst address.
  // This function has the purpose to take away collateral from the system that doesn't correspond to the cdp but was sent there wrongly.
  function moveCollateral(
    bytes32 collateralPoolId,
    uint256 cdp,
    address dst,
    uint256 wad
  ) public cdpAllowed(cdp) {
    GovernmentLike(government).moveCollateral(collateralPoolId, positions[cdp], dst, wad);
  }

  // Transfer wad amount of DAI from the cdp address to a dst address.
  function moveStablecoin(
    uint256 cdp,
    address dst,
    uint256 rad
  ) public cdpAllowed(cdp) {
    GovernmentLike(government).moveStablecoin(positions[cdp], dst, rad);
  }

  // Quit the system, migrating the cdp (ink, art) to a different dst positionAddress
  function quit(uint256 cdp, address dst) public cdpAllowed(cdp) positionAllowed(dst) {
    (uint256 lockedCollateral, uint256 debtShare) =
      GovernmentLike(government).positions(collateralPools[cdp], positions[cdp]);
    GovernmentLike(government).movePosition(
      collateralPools[cdp],
      positions[cdp],
      dst,
      toInt(lockedCollateral),
      toInt(debtShare)
    );
  }

  // Import a position from src urn to the urn owned by cdp
  function enter(address src, uint256 cdp) public positionAllowed(src) cdpAllowed(cdp) {
    (uint256 lockedCollateral, uint256 debtShare) = GovernmentLike(government).positions(collateralPools[cdp], src);
    GovernmentLike(government).movePosition(
      collateralPools[cdp],
      src,
      positions[cdp],
      toInt(lockedCollateral),
      toInt(debtShare)
    );
  }

  // Move a position from cdpSrc urn to the cdpDst urn
  function shift(uint256 cdpSrc, uint256 cdpDst) public cdpAllowed(cdpSrc) cdpAllowed(cdpDst) {
    require(collateralPools[cdpSrc] == collateralPools[cdpDst], "non-matching-cdps");
    (uint256 lockedCollateral, uint256 debtShare) =
      GovernmentLike(government).positions(collateralPools[cdpSrc], positions[cdpSrc]);
    GovernmentLike(government).movePosition(
      collateralPools[cdpSrc],
      positions[cdpSrc],
      positions[cdpDst],
      toInt(lockedCollateral),
      toInt(debtShare)
    );
  }
}
