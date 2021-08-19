// SPDX-License-Identifier: AGPL-3.0-or-later

/// flop.sol -- Debt auction

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

  function mintUnbackedStablecoin(
    address,
    address,
    uint256
  ) external;
}

interface TokenLike {
  function mint(address, uint256) external;
}

interface SystemDebtEngine {
  function totalBadDebtInAuction() external returns (uint256);

  function settleSystemBadDebtByAuction(uint256) external;
}

/*
   This thing creates alpacas on demand in return for dai.

 - `lot` alpacas in return for bid
 - `bid` dai paid
 - `recipient` receives dai income
 - `bidLifetime` single bid lifetime
 - `minimumBidIncrease` minimum bid increase
 - `auctionExpiry` max auction duration
*/

contract BadDebtAuctioneer {
  // --- Auth ---
  mapping(address => uint256) public whitelist;

  function rely(address usr) external auth {
    whitelist[usr] = 1;
  }

  function deny(address usr) external auth {
    whitelist[usr] = 0;
  }

  modifier auth {
    require(whitelist[msg.sender] == 1, "BadDebtAuctioneer/not-authorized");
    _;
  }

  // --- Data ---
  struct Bid {
    uint256 bid; // dai paid                [rad]
    uint256 lot; // alpacas in return for bid  [wad]
    address bidder; // high bidder
    uint48 bidExpiry; // bid expiry time         [unix epoch time]
    uint48 auctionExpiry; // auction expiry time     [unix epoch time]
  }

  mapping(uint256 => Bid) public bids;

  BookKeeperLike public bookKeeper; // CDP Engine
  TokenLike public alpaca;

  uint256 constant ONE = 1.00E18;
  uint256 public minimumBidIncrease = 1.05E18; // 5% minimum bid increase
  uint256 public lotSizeIncreaseWhenReset = 1.50E18; // 50% lot increase for tick
  uint48 public bidLifetime = 3 hours; // 3 hours bid lifetime         [seconds]
  uint48 public auctionLength = 2 days; // 2 days total auction length  [seconds]
  uint256 public kicks = 0;
  uint256 public live; // Active Flag
  address public systemDebtEngine; // not used until shutdown

  // --- Events ---
  event Kick(uint256 id, uint256 lot, uint256 bid, address indexed recipient);

  // --- Init ---
  constructor(address _bookKeeper, address alpaca_) public {
    whitelist[msg.sender] = 1;
    bookKeeper = BookKeeperLike(_bookKeeper);
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

  function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
    if (x > y) {
      z = y;
    } else {
      z = x;
    }
  }

  // --- Admin ---
  function file(bytes32 what, uint256 data) external auth {
    if (what == "minimumBidIncrease") minimumBidIncrease = data;
    else if (what == "lotSizeIncreaseWhenReset") lotSizeIncreaseWhenReset = data;
    else if (what == "bidLifetime") bidLifetime = uint48(data);
    else if (what == "auctionLength") auctionLength = uint48(data);
    else revert("BadDebtAuctioneer/file-unrecognized-param");
  }

  // --- Auction ---
  function startAuction(
    address recipient,
    uint256 lot,
    uint256 bid
  ) external auth returns (uint256 id) {
    require(live == 1, "BadDebtAuctioneer/not-live");
    require(kicks < uint256(-1), "BadDebtAuctioneer/overflow");
    id = ++kicks;

    bids[id].bid = bid;
    bids[id].lot = lot;
    bids[id].bidder = recipient;
    bids[id].auctionExpiry = add(uint48(now), auctionLength);

    emit Kick(id, lot, bid, recipient);
  }

  function tick(uint256 id) external {
    require(bids[id].auctionExpiry < now, "BadDebtAuctioneer/not-finished");
    require(bids[id].bidExpiry == 0, "BadDebtAuctioneer/bid-already-placed");
    bids[id].lot = mul(lotSizeIncreaseWhenReset, bids[id].lot) / ONE;
    bids[id].auctionExpiry = add(uint48(now), auctionLength);
  }

  function dent(
    uint256 id,
    uint256 lot,
    uint256 bid
  ) external {
    require(live == 1, "BadDebtAuctioneer/not-live");
    require(bids[id].bidder != address(0), "BadDebtAuctioneer/bidder-not-set");
    require(bids[id].bidExpiry > now || bids[id].bidExpiry == 0, "BadDebtAuctioneer/already-finished-expiry");
    require(bids[id].auctionExpiry > now, "BadDebtAuctioneer/already-finished-end");

    require(bid == bids[id].bid, "BadDebtAuctioneer/not-matching-bid");
    require(lot < bids[id].lot, "BadDebtAuctioneer/lot-not-lower");
    require(mul(minimumBidIncrease, lot) <= mul(bids[id].lot, ONE), "BadDebtAuctioneer/insufficient-decrease");

    if (msg.sender != bids[id].bidder) {
      bookKeeper.moveStablecoin(msg.sender, bids[id].bidder, bid);

      // on first dent, clear as much totalBadDebtInAuction as possible
      if (bids[id].bidExpiry == 0) {
        uint256 totalBadDebtInAuction = SystemDebtEngine(bids[id].bidder).totalBadDebtInAuction();
        SystemDebtEngine(bids[id].bidder).settleSystemBadDebtByAuction(min(bid, totalBadDebtInAuction));
      }

      bids[id].bidder = msg.sender;
    }

    bids[id].lot = lot;
    bids[id].bidExpiry = add(uint48(now), bidLifetime);
  }

  function deal(uint256 id) external {
    require(live == 1, "BadDebtAuctioneer/not-live");
    require(
      bids[id].bidExpiry != 0 && (bids[id].bidExpiry < now || bids[id].auctionExpiry < now),
      "BadDebtAuctioneer/not-finished"
    );
    alpaca.mint(bids[id].bidder, bids[id].lot);
    delete bids[id];
  }

  // --- Shutdown ---
  function cage() external auth {
    live = 0;
    systemDebtEngine = msg.sender;
  }

  function yank(uint256 id) external {
    require(live == 0, "BadDebtAuctioneer/still-live");
    require(bids[id].bidder != address(0), "BadDebtAuctioneer/bidder-not-set");
    bookKeeper.mintUnbackedStablecoin(systemDebtEngine, bids[id].bidder, bids[id].bid);
    delete bids[id];
  }
}
