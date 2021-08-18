// SPDX-License-Identifier: AGPL-3.0-or-later

/// flap.sol -- Surplus auction

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

interface BookKeeperLike {
  function moveStablecoin(
    address,
    address,
    uint256
  ) external;
}

interface TokenLike {
  function move(
    address,
    address,
    uint256
  ) external;

  function burn(address, uint256) external;
}

/*
   This thing lets you sell some dai in return for alpacas.

 - `lot` dai in return for bid
 - `bid` alpacas paid
 - `bidLifetime` single bid lifetime
 - `minimumBidIncrease` minimum bid increase
 - `auctionExpiry` max auction duration
*/

contract SurplusAuctioneer {
  // --- Auth ---
  mapping(address => uint256) public whitelist;

  function rely(address usr) external auth {
    whitelist[usr] = 1;
  }

  function deny(address usr) external auth {
    whitelist[usr] = 0;
  }

  modifier auth {
    require(whitelist[msg.sender] == 1, "SurplusAuctioneer/not-authorized");
    _;
  }

  // --- Data ---
  struct Bid {
    uint256 bid; // alpacas paid               [wad]
    uint256 lot; // dai in return for bid   [rad]
    address bidder; // high bidder
    uint48 bidExpiry; // bid expiry time         [unix epoch time]
    uint48 auctionExpiry; // auction expiry time     [unix epoch time]
  }

  mapping(uint256 => Bid) public bids;

  BookKeeperLike public bookKeeper; // CDP Engine
  TokenLike public alpaca;

  uint256 constant ONE = 1.00E18;
  uint256 public minimumBidIncrease = 1.05E18; // 5% minimum bid increase
  uint48 public bidLifetime = 3 hours; // 3 hours bid duration         [seconds]
  uint48 public auctionLength = 2 days; // 2 days total auction length  [seconds]
  uint256 public kicks = 0;
  uint256 public live; // Active Flag

  // --- Events ---
  event Kick(uint256 id, uint256 lot, uint256 bid);

  // --- Init ---
  constructor(address bookKeeper_, address alpaca_) public {
    whitelist[msg.sender] = 1;
    bookKeeper = BookKeeperLike(bookKeeper_);
    alpaca = TokenLike(alpaca_);
    live = 1;
  }

  // --- Math ---
  function add(uint48 x, uint48 y) internal pure returns (uint48 z) {
    require((z = x + y) >= x);
  }

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x);
  }

  // --- Admin ---
  function file(bytes32 what, uint256 data) external auth {
    if (what == "minimumBidIncrease") minimumBidIncrease = data;
    else if (what == "bidLifetime") bidLifetime = uint48(data);
    else if (what == "auctionLength") auctionLength = uint48(data);
    else revert("SurplusAuctioneer/file-unrecognized-param");
  }

  // --- Auction ---
  function startAuction(uint256 lot, uint256 bid) external auth returns (uint256 id) {
    require(live == 1, "SurplusAuctioneer/not-live");
    require(kicks < uint256(-1), "SurplusAuctioneer/overflow");
    id = ++kicks;

    bids[id].bid = bid;
    bids[id].lot = lot;
    bids[id].bidder = msg.sender; // configurable??
    bids[id].auctionExpiry = add(uint48(now), auctionLength);

    bookKeeper.moveStablecoin(msg.sender, address(this), lot);

    emit Kick(id, lot, bid);
  }

  function tick(uint256 id) external {
    require(bids[id].auctionExpiry < now, "SurplusAuctioneer/not-finished");
    require(bids[id].bidExpiry == 0, "SurplusAuctioneer/bid-already-placed");
    bids[id].auctionExpiry = add(uint48(now), auctionLength);
  }

  function tend(
    uint256 id,
    uint256 lot,
    uint256 bid
  ) external {
    require(live == 1, "SurplusAuctioneer/not-live");
    require(bids[id].bidder != address(0), "SurplusAuctioneer/bidder-not-set");
    require(bids[id].bidExpiry > now || bids[id].bidExpiry == 0, "SurplusAuctioneer/already-finished-bidExpiry");
    require(bids[id].auctionExpiry > now, "SurplusAuctioneer/already-finished-auctionExpiry");

    require(lot == bids[id].lot, "SurplusAuctioneer/lot-not-matching");
    require(bid > bids[id].bid, "SurplusAuctioneer/bid-not-higher");
    require(mul(bid, ONE) >= mul(minimumBidIncrease, bids[id].bid), "SurplusAuctioneer/insufficient-increase");

    if (msg.sender != bids[id].bidder) {
      alpaca.move(msg.sender, bids[id].bidder, bids[id].bid);
      bids[id].bidder = msg.sender;
    }
    alpaca.move(msg.sender, address(this), bid - bids[id].bid);

    bids[id].bid = bid;
    bids[id].bidExpiry = add(uint48(now), bidLifetime);
  }

  function deal(uint256 id) external {
    require(live == 1, "SurplusAuctioneer/not-live");
    require(
      bids[id].bidExpiry != 0 && (bids[id].bidExpiry < now || bids[id].auctionExpiry < now),
      "SurplusAuctioneer/not-finished"
    );
    bookKeeper.moveStablecoin(address(this), bids[id].bidder, bids[id].lot);
    alpaca.burn(address(this), bids[id].bid);
    delete bids[id];
  }

  function cage(uint256 rad) external auth {
    live = 0;
    bookKeeper.moveStablecoin(address(this), msg.sender, rad);
  }

  function yank(uint256 id) external {
    require(live == 0, "SurplusAuctioneer/still-live");
    require(bids[id].bidder != address(0), "SurplusAuctioneer/bidder-not-set");
    alpaca.move(address(this), bids[id].bidder, bids[id].bid);
    delete bids[id];
  }
}
