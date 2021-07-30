// SPDX-License-Identifier: AGPL-3.0-or-later

/// spot.sol -- Spotter

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

interface CDPEngineLike {
    function file(bytes32, bytes32, uint) external;
}

interface PipLike {
    function peek() external returns (bytes32, bool);
}

contract PriceOracle {
    // --- Auth ---
    mapping (address => uint) public wards;
    function rely(address guy) external auth { wards[guy] = 1;  }
    function deny(address guy) external auth { wards[guy] = 0; }
    modifier auth {
        require(wards[msg.sender] == 1, "Spotter/not-authorized");
        _;
    }

    // --- Data ---
    struct CollateralType {
        PipLike pip;  // Price Feed
        uint256 mat;  // Liquidation ratio [ray]
    }

    mapping (bytes32 => CollateralType) public collateralTypes;

    CDPEngineLike public vat;  // CDP Engine
    uint256 public stableCoinReferencePrice;  // ref per dai [ray] :: value of stablecoin in the reference asset (e.g. $1 per Alpaca USD)

    uint256 public live;

    // --- Events ---
    event Poke(
      bytes32 ilk,
      bytes32 val,  // [wad]
      uint256 spot  // [ray]
    );

    // --- Init ---
    constructor(address vat_) public {
        wards[msg.sender] = 1;
        vat = CDPEngineLike(vat_);
        stableCoinReferencePrice = ONE;
        live = 1;
    }

    // --- Math ---
    uint constant ONE = 10 ** 27;

    function mul(uint x, uint y) internal pure returns (uint z) {
        require(y == 0 || (z = x * y) / y == x);
    }
    function rdiv(uint x, uint y) internal pure returns (uint z) {
        z = mul(x, ONE) / y;
    }

    // --- Administration ---
    function file(bytes32 ilk, bytes32 what, address pip_) external auth {
        require(live == 1, "Spotter/not-live");
        if (what == "pip") collateralTypes[ilk].pip = PipLike(pip_);
        else revert("Spotter/file-unrecognized-param");
    }
    function file(bytes32 what, uint data) external auth {
        require(live == 1, "Spotter/not-live");
        if (what == "stableCoinReferencePrice") stableCoinReferencePrice = data;
        else revert("Spotter/file-unrecognized-param");
    }
    function file(bytes32 ilk, bytes32 what, uint data) external auth {
        require(live == 1, "Spotter/not-live");
        if (what == "mat") collateralTypes[ilk].mat = data;
        else revert("Spotter/file-unrecognized-param");
    }

    // --- Update value ---
    function poke(bytes32 ilk) external {
        (bytes32 val, bool has) = collateralTypes[ilk].pip.peek();
        uint256 priceWithSafetyMargin = has ? rdiv(rdiv(mul(uint(val), 10 ** 9), stableCoinReferencePrice), collateralTypes[ilk].mat) : 0;
        vat.file(ilk, "priceWithSafetyMargin", priceWithSafetyMargin);
        emit Poke(ilk, val, priceWithSafetyMargin);
    }

    function cage() external auth {
        live = 0;
    }
}
