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

pragma solidity >=0.5.12;

// FIXME: This contract was altered compared to the production version.
// It doesn't use LibNote anymore.
// New deployments of this contract will need to include custom events (TO DO).

interface TokenLike {
    function decimals() external view returns (uint);
    function transfer(address,uint) external returns (bool);
    function transferFrom(address,address,uint) external returns (bool);
}

interface StablecoinLike {
    function mint(address,uint) external;
    function burn(address,uint) external;
}

interface GovernmentLike {
    function addCollateral(bytes32,address,int) external;
    function moveStablecoin(address,address,uint) external;
}

/*
    Here we provide *adapters* to connect the Government to arbitrary external
    token implementations, creating a bounded context for the Government. The
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

contract StablecoinAdapter {
    // --- Auth ---
    mapping (address => uint) public wards;
    function rely(address usr) external auth { wards[usr] = 1; }
    function deny(address usr) external auth { wards[usr] = 0; }
    modifier auth {
        require(wards[msg.sender] == 1, "StablecoinAdapter/not-authorized");
        _;
    }

    GovernmentLike public government;      // CDP Engine
    StablecoinLike public stablecoin;  // Stablecoin Token
    uint    public live;     // Active Flag

    constructor(address government_, address stablecoin_) public {
        wards[msg.sender] = 1;
        live = 1;
        government = GovernmentLike(government_);
        stablecoin = StablecoinLike(stablecoin_);
    }
    function cage() external auth {
        live = 0;
    }
    uint constant ONE = 10 ** 27;
    function mul(uint x, uint y) internal pure returns (uint z) {
        require(y == 0 || (z = x * y) / y == x);
    }
    function deposit(address usr, uint wad) external {
        government.moveStablecoin(address(this), usr, mul(ONE, wad));
        stablecoin.burn(msg.sender, wad);
    }
    function withdraw(address usr, uint wad) external {
        require(live == 1, "StablecoinAdapter/not-live");
        government.moveStablecoin(msg.sender, address(this), mul(ONE, wad));
        stablecoin.mint(usr, wad);
    }
}
