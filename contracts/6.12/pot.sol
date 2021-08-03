// SPDX-License-Identifier: AGPL-3.0-or-later

/// pot.sol -- Dai Savings Rate

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

/*
   "Savings Dai" is obtained when Dai is deposited into
   this contract. Each "Savings Dai" accrues Dai interest
   at the "Dai Savings Rate".

   This contract does not implement a user tradeable token
   and is intended to be used with adapters.

         --- `save` your `dai` in the `pot` ---

   - `savingsRate`: the Dai Savings Rate
   - `share`: user balance of Savings Dai

   - `join`: start saving some dai
   - `exit`: remove some dai
   - `drip`: perform rate collection

*/

interface CDPEngineLike {
    function move(address,address,uint256) external;
    function suck(address,address,uint256) external;
}

contract StablecoinSavings {
    // --- Auth ---
    mapping (address => uint) public wards;
    function rely(address guy) external auth { wards[guy] = 1; }
    function deny(address guy) external auth { wards[guy] = 0; }
    modifier auth {
        require(wards[msg.sender] == 1, "StablecoinSavings/not-authorized");
        _;
    }

    // --- Data ---
    mapping (address => uint256) public share;  // Normalised Savings Dai [wad]

    uint256 public totalShare;   // Total Normalised Savings Dai  [wad]
    uint256 public savingsRate;   // The Dai Savings Rate          [ray]
    uint256 public sharePrice;   // The Rate Accumulator          [ray]

    CDPEngineLike public cdpEngine;   // CDP Engine
    address public debtEngine;   // Debt Engine
    uint256 public lastAccumulationTime;   // Time of last drip     [unix epoch time]

    uint256 public live;  // Active Flag

    // --- Init ---
    constructor(address cdpEngine_) public {
        wards[msg.sender] = 1;
        cdpEngine = CDPEngineLike(cdpEngine_);
        savingsRate = ONE;
        sharePrice = ONE;
        lastAccumulationTime = now;
        live = 1;
    }

    // --- Math ---
    uint256 constant ONE = 10 ** 27;
    function rpow(uint x, uint n, uint base) internal pure returns (uint z) {
        assembly {
            switch x case 0 {switch n case 0 {z := base} default {z := 0}}
            default {
                switch mod(n, 2) case 0 { z := base } default { z := x }
                let half := div(base, 2)  // for rounding.
                for { n := div(n, 2) } n { n := div(n,2) } {
                    let xx := mul(x, x)
                    if iszero(eq(div(xx, x), x)) { revert(0,0) }
                    let xxRound := add(xx, half)
                    if lt(xxRound, xx) { revert(0,0) }
                    x := div(xxRound, base)
                    if mod(n,2) {
                        let zx := mul(z, x)
                        if and(iszero(iszero(x)), iszero(eq(div(zx, x), z))) { revert(0,0) }
                        let zxRound := add(zx, half)
                        if lt(zxRound, zx) { revert(0,0) }
                        z := div(zxRound, base)
                    }
                }
            }
        }
    }

    function rmul(uint x, uint y) internal pure returns (uint z) {
        z = mul(x, y) / ONE;
    }

    function add(uint x, uint y) internal pure returns (uint z) {
        require((z = x + y) >= x);
    }

    function sub(uint x, uint y) internal pure returns (uint z) {
        require((z = x - y) <= x);
    }

    function mul(uint x, uint y) internal pure returns (uint z) {
        require(y == 0 || (z = x * y) / y == x);
    }

    // --- Administration ---
    function file(bytes32 what, uint256 data) external auth {
        require(live == 1, "StablecoinSavings/not-live");
        require(now == lastAccumulationTime, "StablecoinSavings/lastAccumulationTime-not-updated");
        if (what == "savingsRate") savingsRate = data;
        else revert("StablecoinSavings/file-unrecognized-param");
    }

    function file(bytes32 what, address addr) external auth {
        if (what == "debtEngine") debtEngine = addr;
        else revert("StablecoinSavings/file-unrecognized-param");
    }

    function cage() external auth {
        live = 0;
        savingsRate = ONE;
    }

    // --- Savings Rate Accumulation ---
    function drip() external returns (uint tmp) {
        require(now >= lastAccumulationTime, "StablecoinSavings/invalid-now");
        tmp = rmul(rpow(savingsRate, now - lastAccumulationTime, ONE), sharePrice);
        uint sharePrice_ = sub(tmp, sharePrice);
        sharePrice = tmp;
        lastAccumulationTime = now;
        cdpEngine.suck(address(debtEngine), address(this), mul(totalShare, sharePrice_));
    }

    // --- Savings Dai Management ---
    function join(uint shareAmount) external {
        require(now == lastAccumulationTime, "StablecoinSavings/lastAccumulationTime-not-updated");
        share[msg.sender] = add(share[msg.sender], shareAmount);
        totalShare             = add(totalShare,             shareAmount);
        cdpEngine.move(msg.sender, address(this), mul(sharePrice, shareAmount));
    }

    function exit(uint shareAmount) external {
        share[msg.sender] = sub(share[msg.sender], shareAmount);
        totalShare             = sub(totalShare,             shareAmount);
        cdpEngine.move(address(this), msg.sender, mul(sharePrice, shareAmount));
    }
}
