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

pragma solidity >=0.5.12;

interface GovernmentLike {
    function positions(bytes32, address) external view returns (uint, uint);
    function hope(address) external;
    function moveCollateral(bytes32, address, address, uint) external;
    function moveStablecoin(address, address, uint) external;
    function adjustPosition(bytes32, address, address, address, int, int) external;
    function movePosition(bytes32, address, address, int, int) external;
}

contract UrnHandler {
    constructor(address government) public {
        GovernmentLike(government).hope(msg.sender);
    }
}

contract CDPManager {
    address                   public government;
    uint                      public cdpi;      // Auto incremental
    mapping (uint => address) public positions;      // CDPId => UrnHandler
    mapping (uint => List)    public list;      // CDPId => Prev & Next CDPIds (double linked list)
    mapping (uint => address) public owns;      // CDPId => Owner
    mapping (uint => bytes32) public collateralPools;      // CDPId => Ilk

    mapping (address => uint) public first;     // Owner => First CDPId
    mapping (address => uint) public last;      // Owner => Last CDPId
    mapping (address => uint) public count;     // Owner => Amount of CDPs

    mapping (
        address => mapping (
            uint => mapping (
                address => uint
            )
        )
    ) public cdpCan;                            // Owner => CDPId => Allowed Addr => True/False

    mapping (
        address => mapping (
            address => uint
        )
    ) public positionCan;                            // Urn => Allowed Addr => True/False

    struct List {
        uint prev;
        uint next;
    }

    event NewCdp(address indexed usr, address indexed own, uint indexed cdp);

    modifier cdpAllowed(
        uint cdp
    ) {
        require(msg.sender == owns[cdp] || cdpCan[owns[cdp]][cdp][msg.sender] == 1, "cdp-not-allowed");
        _;
    }

    modifier positionAllowed(
        address positionAddress
    ) {
        require(msg.sender == positionAddress || positionCan[positionAddress][msg.sender] == 1, "urn-not-allowed");
        _;
    }

    constructor(address government_) public {
        government = government_;
    }

    function add(uint x, uint y) internal pure returns (uint z) {
        require((z = x + y) >= x);
    }

    function sub(uint x, uint y) internal pure returns (uint z) {
        require((z = x - y) <= x);
    }

    function toInt(uint x) internal pure returns (int y) {
        y = int(x);
        require(y >= 0);
    }

    // Allow/disallow a usr address to manage the cdp.
    function cdpAllow(
        uint cdp,
        address usr,
        uint ok
    ) public cdpAllowed(cdp) {
        cdpCan[owns[cdp]][cdp][usr] = ok;
    }

    // Allow/disallow a usr address to quit to the the sender urn.
    function urnAllow(
        address usr,
        uint ok
    ) public {
        positionCan[msg.sender][usr] = ok;
    }

    // Open a new cdp for a given usr address.
    function open(
        bytes32 collateralPoolId,
        address usr
    ) public returns (uint) {
        require(usr != address(0), "usr-address-0");

        cdpi = add(cdpi, 1);
        positions[cdpi] = address(new UrnHandler(government));
        owns[cdpi] = usr;
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
    function give(
        uint cdp,
        address dst
    ) public cdpAllowed(cdp) {
        require(dst != address(0), "dst-address-0");
        require(dst != owns[cdp], "dst-already-owner");

        // Remove transferred CDP from double linked list of origin user and pointers
        if (list[cdp].prev != 0) {
            list[list[cdp].prev].next = list[cdp].next;         // Set the next pointer of the prev cdp (if exists) to the next of the transferred one
        }
        if (list[cdp].next != 0) {                              // If wasn't the last one
            list[list[cdp].next].prev = list[cdp].prev;         // Set the prev pointer of the next cdp to the prev of the transferred one
        } else {                                                // If was the last one
            last[owns[cdp]] = list[cdp].prev;                   // Update last pointer of the owner
        }
        if (first[owns[cdp]] == cdp) {                          // If was the first one
            first[owns[cdp]] = list[cdp].next;                  // Update first pointer of the owner
        }
        count[owns[cdp]] = sub(count[owns[cdp]], 1);

        // Transfer ownership
        owns[cdp] = dst;

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
        uint cdp,
        int collateralValue,
        int debtShare
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
        uint cdp,
        address dst,
        uint wad
    ) public cdpAllowed(cdp) {
        GovernmentLike(government).moveCollateral(collateralPools[cdp], positions[cdp], dst, wad);
    }

    // Transfer wad amount of any type of collateral (collateralPoolId) from the cdp address to a dst address.
    // This function has the purpose to take away collateral from the system that doesn't correspond to the cdp but was sent there wrongly.
    function moveCollateral(
        bytes32 collateralPoolId,
        uint cdp,
        address dst,
        uint wad
    ) public cdpAllowed(cdp) {
        GovernmentLike(government).moveCollateral(collateralPoolId, positions[cdp], dst, wad);
    }

    // Transfer wad amount of DAI from the cdp address to a dst address.
    function move(
        uint cdp,
        address dst,
        uint rad
    ) public cdpAllowed(cdp) {
        GovernmentLike(government).moveStablecoin(positions[cdp], dst, rad);
    }

    // Quit the system, migrating the cdp (ink, art) to a different dst positionAddress
    function quit(
        uint cdp,
        address dst
    ) public cdpAllowed(cdp) positionAllowed(dst) {
        (uint lockedCollateral, uint debtShare) = GovernmentLike(government).positions(collateralPools[cdp], positions[cdp]);
        GovernmentLike(government).movePosition(
            collateralPools[cdp],
            positions[cdp],
            dst,
            toInt(lockedCollateral),
            toInt(debtShare)
        );
    }

    // Import a position from src urn to the urn owned by cdp
    function enter(
        address src,
        uint cdp
    ) public positionAllowed(src) cdpAllowed(cdp) {
        (uint lockedCollateral, uint debtShare) = GovernmentLike(government).positions(collateralPools[cdp], src);
        GovernmentLike(government).movePosition(
            collateralPools[cdp],
            src,
            positions[cdp],
            toInt(lockedCollateral),
            toInt(debtShare)
        );
    }

    // Move a position from cdpSrc urn to the cdpDst urn
    function shift(
        uint cdpSrc,
        uint cdpDst
    ) public cdpAllowed(cdpSrc) cdpAllowed(cdpDst) {
        require(collateralPools[cdpSrc] == collateralPools[cdpDst], "non-matching-cdps");
        (uint lockedCollateral, uint debtShare) = GovernmentLike(government).positions(collateralPools[cdpSrc], positions[cdpSrc]);
        GovernmentLike(government).movePosition(
            collateralPools[cdpSrc],
            positions[cdpSrc],
            positions[cdpDst],
            toInt(lockedCollateral),
            toInt(debtShare)
        );
    }
}