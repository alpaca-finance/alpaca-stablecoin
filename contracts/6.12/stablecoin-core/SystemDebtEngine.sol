// SPDX-License-Identifier: AGPL-3.0-or-later

/// systemDebtEngine.sol -- stablecoin settlement module

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
import "../interfaces/IBookKeeper.sol";
import "../interfaces/ISurplusAuctioneer.sol";
import "../interfaces/IBadDebtAuctioneer.sol";

// FIXME: This contract was altered compared to the production version.
// It doesn't use LibNote anymore.
// New deployments of this contract will need to include custom events (TO DO).

contract SystemDebtEngine is
  OwnableUpgradeable,
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable
{
  // --- Auth ---
  mapping(address => uint256) public whitelist;

  function rely(address usr) external auth {
    require(live == 1, "SystemDebtEngine/not-live");
    whitelist[usr] = 1;
  }

  function deny(address usr) external auth {
    whitelist[usr] = 0;
  }

  modifier auth {
    require(whitelist[msg.sender] == 1, "SystemDebtEngine/not-authorized");
    _;
  }

  // --- Data ---
  IBookKeeper public bookKeeper; // CDP Engine
  ISurplusAuctioneer public surplusAuctionHouse; // Surplus Auction House
  IBadDebtAuctioneer public badDebtAuctionHouse; // Debt Auction House

  mapping(uint256 => uint256) public badDebtQueue; // debt queue
  uint256 public totalBadDebtValue; // Queued debt            [rad]
  uint256 public totalBadDebtInAuction; // On-auction debt        [rad]

  uint256 public badDebtAuctionDelay; // Flop delay             [seconds]
  uint256 public alpacaInitialLotSizeForBadDebt; // Flop initial lot size  [wad]
  uint256 public badDebtFixedBidSize; // Flop fixed bid size    [rad]

  uint256 public surplusAuctionFixedLotSize; // Flap fixed lot size    [rad]
  uint256 public surplusBuffer; // Surplus buffer         [rad]

  uint256 public live; // Active Flag

  // --- Init ---
  function initialize(
    address _bookKeeper,
    address surplusAuctionHouse_,
    address badDebtAuctionHouse_
  ) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    whitelist[msg.sender] = 1;
    bookKeeper = IBookKeeper(_bookKeeper);
    surplusAuctionHouse = ISurplusAuctioneer(surplusAuctionHouse_);
    badDebtAuctionHouse = IBadDebtAuctioneer(badDebtAuctionHouse_);
    bookKeeper.hope(surplusAuctionHouse_);
    live = 1;
  }

  // --- Math ---
  function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x + y) >= x);
  }

  function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x - y) <= x);
  }

  function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
    return x <= y ? x : y;
  }

  // --- Administration ---
  function file(bytes32 what, uint256 data) external auth {
    if (what == "badDebtAuctionDelay") badDebtAuctionDelay = data;
    else if (what == "surplusAuctionFixedLotSize") surplusAuctionFixedLotSize = data;
    else if (what == "badDebtFixedBidSize") badDebtFixedBidSize = data;
    else if (what == "alpacaInitialLotSizeForBadDebt") alpacaInitialLotSizeForBadDebt = data;
    else if (what == "surplusBuffer") surplusBuffer = data;
    else revert("SystemDebtEngine/file-unrecognized-param");
  }

  function file(bytes32 what, address data) external auth {
    if (what == "surplusAuctionHouse") {
      bookKeeper.nope(address(surplusAuctionHouse));
      surplusAuctionHouse = ISurplusAuctioneer(data);
      bookKeeper.hope(data);
    } else if (what == "badDebtAuctionHouse") badDebtAuctionHouse = IBadDebtAuctioneer(data);
    else revert("SystemDebtEngine/file-unrecognized-param");
  }

  // Push to debt-queue
  function pushToBadDebtQueue(uint256 tab) external auth {
    badDebtQueue[now] = add(badDebtQueue[now], tab);
    totalBadDebtValue = add(totalBadDebtValue, tab);
  }

  // Pop from debt-queue
  function popFromBadDebtQueue(uint256 timestamp) external nonReentrant {
    require(add(timestamp, badDebtAuctionDelay) <= now, "SystemDebtEngine/badDebtAuctionDelay-not-finished");
    totalBadDebtValue = sub(totalBadDebtValue, badDebtQueue[timestamp]);
    badDebtQueue[timestamp] = 0;
  }

  // Debt settlement
  function settleSystemBadDebt(uint256 rad) external nonReentrant {
    require(rad <= bookKeeper.stablecoin(address(this)), "SystemDebtEngine/insufficient-surplus");
    require(
      rad <= sub(sub(bookKeeper.systemBadDebt(address(this)), totalBadDebtValue), totalBadDebtInAuction),
      "SystemDebtEngine/insufficient-debt"
    );
    bookKeeper.settleSystemBadDebt(rad);
  }

  function settleSystemBadDebtByAuction(uint256 rad) external nonReentrant {
    require(rad <= totalBadDebtInAuction, "SystemDebtEngine/not-enough-ash");
    require(rad <= bookKeeper.stablecoin(address(this)), "SystemDebtEngine/insufficient-surplus");
    totalBadDebtInAuction = sub(totalBadDebtInAuction, rad);
    bookKeeper.settleSystemBadDebt(rad);
  }

  // Debt auction
  function startBadDebtAuction() external nonReentrant returns (uint256 id) {
    require(
      badDebtFixedBidSize <=
        sub(sub(bookKeeper.systemBadDebt(address(this)), totalBadDebtValue), totalBadDebtInAuction),
      "SystemDebtEngine/insufficient-debt"
    );
    require(bookKeeper.stablecoin(address(this)) == 0, "SystemDebtEngine/surplus-not-zero");
    totalBadDebtInAuction = add(totalBadDebtInAuction, badDebtFixedBidSize);
    id = badDebtAuctionHouse.startAuction(address(this), alpacaInitialLotSizeForBadDebt, badDebtFixedBidSize);
  }

  // Surplus auction
  function startSurplusAuction() external nonReentrant returns (uint256 id) {
    require(
      bookKeeper.stablecoin(address(this)) >=
        add(add(bookKeeper.systemBadDebt(address(this)), surplusAuctionFixedLotSize), surplusBuffer),
      "SystemDebtEngine/insufficient-surplus"
    );
    require(
      sub(sub(bookKeeper.systemBadDebt(address(this)), totalBadDebtValue), totalBadDebtInAuction) == 0,
      "SystemDebtEngine/debt-not-zero"
    );
    id = surplusAuctionHouse.startAuction(surplusAuctionFixedLotSize, 0);
  }

  function cage() external auth {
    require(live == 1, "SystemDebtEngine/not-live");
    live = 0;
    totalBadDebtValue = 0;
    totalBadDebtInAuction = 0;
    surplusAuctionHouse.cage(bookKeeper.stablecoin(address(surplusAuctionHouse)));
    badDebtAuctionHouse.cage();
    bookKeeper.settleSystemBadDebt(min(bookKeeper.stablecoin(address(this)), bookKeeper.systemBadDebt(address(this))));
  }
}
