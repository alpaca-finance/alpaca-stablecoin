// SPDX-License-Identifier: AGPL-3.0-or-later

/// systemDebtEngine.sol -- Dai settlement module

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

pragma solidity >=0.5.12;

// FIXME: This contract was altered compared to the production version.
// It doesn't use LibNote anymore.
// New deployments of this contract will need to include custom events (TO DO).

interface BadDebtAuctioneerLike {
    function kick(address gal, uint lot, uint bid) external returns (uint);
    function cage() external;
    function live() external returns (uint);
}

interface SurplusAuctioneerLike {
    function kick(uint lot, uint bid) external returns (uint);
    function cage(uint) external;
    function live() external returns (uint);
}

interface GovernmentLike {
    function dai (address) external view returns (uint);
    function systemBadDebt (address) external view returns (uint);
    function settleSystemBadDebt(uint256) external;
    function hope(address) external;
    function nope(address) external;
}

contract SystemDebtEngine {
    // --- Auth ---
    mapping (address => uint) public whitelist;
    function rely(address usr) external auth { require(live == 1, "SystemDebtEngine/not-live"); whitelist[usr] = 1; }
    function deny(address usr) external auth { whitelist[usr] = 0; }
    modifier auth {
        require(whitelist[msg.sender] == 1, "SystemDebtEngine/not-authorized");
        _;
    }

    // --- Data ---
    GovernmentLike public government;        // CDP Engine
    SurplusAuctioneerLike public surplusAuctionHouse;   // Surplus Auction House
    BadDebtAuctioneerLike public badDebtAuctionHouse;   // Debt Auction House

    mapping (uint256 => uint256) public badDebtQueue;  // debt queue
    uint256 public totalBadDebtValue;   // Queued debt            [rad]
    uint256 public totalBadDebtInAuction;   // On-auction debt        [rad]

    uint256 public badDebtAuctionDelay;  // Flop delay             [seconds]
    uint256 public alpacaInitialLotSizeForBadDebt;  // Flop initial lot size  [wad]
    uint256 public badDebtFixedBidSize;  // Flop fixed bid size    [rad]

    uint256 public surplusAuctionFixedLotSize;  // Flap fixed lot size    [rad]
    uint256 public surplusBuffer;  // Surplus buffer         [rad]

    uint256 public live;  // Active Flag

    // --- Init ---
    constructor(address government_, address surplusAuctionHouse_, address badDebtAuctionHouse_) public {
        whitelist[msg.sender] = 1;
        government     = GovernmentLike(government_);
        surplusAuctionHouse = SurplusAuctioneerLike(surplusAuctionHouse_);
        badDebtAuctionHouse = BadDebtAuctioneerLike(badDebtAuctionHouse_);
        government.hope(surplusAuctionHouse_);
        live = 1;
    }

    // --- Math ---
    function add(uint x, uint y) internal pure returns (uint z) {
        require((z = x + y) >= x);
    }
    function sub(uint x, uint y) internal pure returns (uint z) {
        require((z = x - y) <= x);
    }
    function min(uint x, uint y) internal pure returns (uint z) {
        return x <= y ? x : y;
    }

    // --- Administration ---
    function file(bytes32 what, uint data) external auth {
        if (what == "badDebtAuctionDelay") badDebtAuctionDelay = data;
        else if (what == "surplusAuctionFixedLotSize") surplusAuctionFixedLotSize = data;
        else if (what == "badDebtFixedBidSize") badDebtFixedBidSize = data;
        else if (what == "alpacaInitialLotSizeForBadDebt") alpacaInitialLotSizeForBadDebt = data;
        else if (what == "surplusBuffer") surplusBuffer = data;
        else revert("SystemDebtEngine/file-unrecognized-param");
    }

    function file(bytes32 what, address data) external auth {
        if (what == "surplusAuctionHouse") {
            government.nope(address(surplusAuctionHouse));
            surplusAuctionHouse = SurplusAuctioneerLike(data);
            government.hope(data);
        }
        else if (what == "badDebtAuctionHouse") badDebtAuctionHouse = BadDebtAuctioneerLike(data);
        else revert("SystemDebtEngine/file-unrecognized-param");
    }

    // Push to debt-queue
    function fess(uint tab) external auth {
        badDebtQueue[now] = add(badDebtQueue[now], tab);
        totalBadDebtValue = add(totalBadDebtValue, tab);
    }
    // Pop from debt-queue
    function flog(uint currentTimestamp) external {
        require(add(currentTimestamp, badDebtAuctionDelay) <= now, "SystemDebtEngine/badDebtAuctionDelay-not-finished");
        totalBadDebtValue = sub(totalBadDebtValue, badDebtQueue[currentTimestamp]);
        badDebtQueue[currentTimestamp] = 0;
    }

    // Debt settlement
    function settleSystemBadDebt(uint rad) external {
        require(rad <= government.dai(address(this)), "SystemDebtEngine/insufficient-surplus");
        require(rad <= sub(sub(government.systemBadDebt(address(this)), totalBadDebtValue), totalBadDebtInAuction), "SystemDebtEngine/insufficient-debt");
        government.settleSystemBadDebt(rad);
    }
    function kiss(uint rad) external {
        require(rad <= totalBadDebtInAuction, "SystemDebtEngine/not-enough-ash");
        require(rad <= government.dai(address(this)), "SystemDebtEngine/insufficient-surplus");
        totalBadDebtInAuction = sub(totalBadDebtInAuction, rad);
        government.settleSystemBadDebt(rad);
    }

    // Debt auction
    function flop() external returns (uint id) {
        require(badDebtFixedBidSize <= sub(sub(government.systemBadDebt(address(this)), totalBadDebtValue), totalBadDebtInAuction), "SystemDebtEngine/insufficient-debt");
        require(government.dai(address(this)) == 0, "SystemDebtEngine/surplus-not-zero");
        totalBadDebtInAuction = add(totalBadDebtInAuction, badDebtFixedBidSize);
        id = badDebtAuctionHouse.kick(address(this), alpacaInitialLotSizeForBadDebt, badDebtFixedBidSize);
    }
    // Surplus auction
    function flap() external returns (uint id) {
        require(government.dai(address(this)) >= add(add(government.systemBadDebt(address(this)), surplusAuctionFixedLotSize), surplusBuffer), "SystemDebtEngine/insufficient-surplus");
        require(sub(sub(government.systemBadDebt(address(this)), totalBadDebtValue), totalBadDebtInAuction) == 0, "SystemDebtEngine/debt-not-zero");
        id = surplusAuctionHouse.kick(surplusAuctionFixedLotSize, 0);
    }

    function cage() external auth {
        require(live == 1, "SystemDebtEngine/not-live");
        live = 0;
        totalBadDebtValue = 0;
        totalBadDebtInAuction = 0;
        surplusAuctionHouse.cage(government.dai(address(surplusAuctionHouse)));
        badDebtAuctionHouse.cage();
        government.settleSystemBadDebt(min(government.dai(address(this)), government.systemBadDebt(address(this))));
    }
}
