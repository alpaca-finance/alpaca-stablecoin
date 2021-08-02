// SPDX-License-Identifier: AGPL-3.0-or-later

/// vat.sol -- Dai CDP database

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

contract CDPEngine {
    // --- Auth ---
    mapping (address => uint) public wards;
    function rely(address usr) external auth { require(live == 1, "CDPEngine/not-live"); wards[usr] = 1; }
    function deny(address usr) external auth { require(live == 1, "CDPEngine/not-live"); wards[usr] = 0; }
    modifier auth {
        require(wards[msg.sender] == 1, "CDPEngine/not-authorized");
        _;
    }

    mapping(address => mapping (address => uint)) public can;
    function hope(address usr) external { can[msg.sender][usr] = 1; }
    function nope(address usr) external { can[msg.sender][usr] = 0; }
    function wish(address bit, address usr) internal view returns (bool) {
        return either(bit == usr, can[bit][usr] == 1);
    }

    // --- Data ---
    struct CollateralType {
        uint256 totalDebtShare;   // Total Normalised Debt     [wad]
        uint256 debtAccumulatedRate;  // Accumulated Rates         [ray]
        uint256 priceWithSafetyMargin;  // Price with Safety Margin  [ray]
        uint256 debtCeiling;  // Debt Ceiling              [rad]
        uint256 debtFloor;  // Position Debt Floor            [rad]
    }
    struct Position {
        uint256 lockedCollateral;   // Locked Collateral  [wad]
        uint256 debtShare;   // Normalised Debt    [wad]
    }

    mapping (bytes32 => CollateralType)                       public collateralTypes;
    mapping (bytes32 => mapping (address => Position )) public positions;
    mapping (bytes32 => mapping (address => uint)) public collateralToken;  // [wad]
    mapping (address => uint256)                   public stablecoin;  // [rad]
    mapping (address => uint256)                   public systemDebt;  // [rad]

    uint256 public totalStablecoinIssued;  // Total Dai Issued    [rad]
    uint256 public totalUnbackedStablecoin;  // Total Unbacked Dai  [rad]
    uint256 public totalDebtCeiling;  // Total Debt Ceiling  [rad]
    uint256 public live;  // Active Flag

    // --- Init ---
    constructor() public {
        wards[msg.sender] = 1;
        live = 1;
    }

    // --- Math ---
    function add(uint x, int y) internal pure returns (uint z) {
        z = x + uint(y);
        require(y >= 0 || z <= x);
        require(y <= 0 || z >= x);
    }
    function sub(uint x, int y) internal pure returns (uint z) {
        z = x - uint(y);
        require(y <= 0 || z <= x);
        require(y >= 0 || z >= x);
    }
    function mul(uint x, int y) internal pure returns (int z) {
        z = int(x) * y;
        require(int(x) >= 0);
        require(y == 0 || z / y == int(x));
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
    function init(bytes32 ilk) external auth {
        require(collateralTypes[ilk].debtAccumulatedRate == 0, "CDPEngine/ilk-already-init");
        collateralTypes[ilk].debtAccumulatedRate = 10 ** 27;
    }
    function file(bytes32 what, uint data) external auth {
        require(live == 1, "CDPEngine/not-live");
        if (what == "totalDebtCeiling") totalDebtCeiling = data;
        else revert("CDPEngine/file-unrecognized-param");
    }
    function file(bytes32 ilk, bytes32 what, uint data) external auth {
        require(live == 1, "CDPEngine/not-live");
        if (what == "priceWithSafetyMargin") collateralTypes[ilk].priceWithSafetyMargin = data;
        else if (what == "debtCeiling") collateralTypes[ilk].debtCeiling = data;
        else if (what == "debtFloor") collateralTypes[ilk].debtFloor = data;
        else revert("CDPEngine/file-unrecognized-param");
    }
    function cage() external auth {
        live = 0;
    }

    // --- Fungibility ---
    function slip(bytes32 ilk, address usr, int256 wad) external auth {
        collateralToken[ilk][usr] = add(collateralToken[ilk][usr], wad);
    }
    function flux(bytes32 ilk, address src, address dst, uint256 wad) external {
        require(wish(src, msg.sender), "CDPEngine/not-allowed");
        collateralToken[ilk][src] = sub(collateralToken[ilk][src], wad);
        collateralToken[ilk][dst] = add(collateralToken[ilk][dst], wad);
    }
    function move(address src, address dst, uint256 rad) external {
        require(wish(src, msg.sender), "CDPEngine/not-allowed");
        stablecoin[src] = sub(stablecoin[src], rad);
        stablecoin[dst] = add(stablecoin[dst], rad);
    }

    function either(bool x, bool y) internal pure returns (bool z) {
        assembly{ z := or(x, y)}
    }
    function both(bool x, bool y) internal pure returns (bool z) {
        assembly{ z := and(x, y)}
    }

    // --- CDP Manipulation ---
    function adjustPosition(bytes32 collateralIndex, address positionAddress, address collateralOwner, address stablecoinOwner, int collateralValue, int debtShare) external {
        // system is live
        require(live == 1, "CDPEngine/not-live");

        Position memory position = positions[collateralIndex][positionAddress];
        CollateralType memory collateralType = collateralTypes[collateralIndex];
        // collateralType has been initialised
        require(collateralType.debtAccumulatedRate != 0, "CDPEngine/collateralType-not-init");

        position.lockedCollateral = add(position.lockedCollateral, collateralValue);
        position.debtShare = add(position.debtShare, debtShare);
        collateralType.totalDebtShare = add(collateralType.totalDebtShare, debtShare);

        int debtValue = mul(collateralType.debtAccumulatedRate, debtShare);
        uint positionDebtValue = mul(collateralType.debtAccumulatedRate, position.debtShare);
        totalStablecoinIssued     = add(totalStablecoinIssued, debtValue);

        // either debt has decreased, or debt ceilings are not exceeded
        require(either(debtShare <= 0, both(mul(collateralType.totalDebtShare, collateralType.debtAccumulatedRate) <= collateralType.debtCeiling, totalStablecoinIssued <= totalDebtCeiling)), "CDPEngine/ceiling-exceeded");
        // position is either less risky than before, or it is safe :: check work factor
        require(either(both(debtShare <= 0, collateralValue >= 0), positionDebtValue <= mul(position.lockedCollateral, collateralType.priceWithSafetyMargin)), "CDPEngine/not-safe");

        // position is either more safe, or the owner consents
        require(either(both(debtShare <= 0, collateralValue >= 0), wish(positionAddress, msg.sender)), "CDPEngine/not-allowed-u");
        // collateral src consents
        require(either(collateralValue <= 0, wish(collateralOwner, msg.sender)), "CDPEngine/not-allowed-v");
        // debt dst consents
        require(either(debtShare >= 0, wish(stablecoinOwner, msg.sender)), "CDPEngine/not-allowed-w");

        // position has no debt, or a non-debtFloory amount
        require(either(position.debtShare == 0, positionDebtValue >= collateralType.debtFloor), "CDPEngine/debtFloor");

        collateralToken[collateralIndex][collateralOwner] = sub(collateralToken[collateralIndex][collateralOwner], collateralValue);
        stablecoin[stablecoinOwner]    = add(stablecoin[stablecoinOwner],    debtValue);

        positions[collateralIndex][positionAddress] = position;
        collateralTypes[collateralIndex]    = collateralType;
    }
    // --- CDP Fungibility ---
    function movePosition(bytes32 collateralType, address src, address dst, int collateralValue, int debtShare) external {
        Position storage u = positions[collateralType][src];
        Position storage v = positions[collateralType][dst];
        CollateralType storage i = collateralTypes[collateralType];

        u.lockedCollateral = sub(u.lockedCollateral, collateralValue);
        u.debtShare = sub(u.debtShare, debtShare);
        v.lockedCollateral = add(v.lockedCollateral, collateralValue);
        v.debtShare = add(v.debtShare, debtShare);

        uint utab = mul(u.debtShare, i.debtAccumulatedRate);
        uint vtab = mul(v.debtShare, i.debtAccumulatedRate);

        // both sides consent
        require(both(wish(src, msg.sender), wish(dst, msg.sender)), "CDPEngine/not-allowed");

        // both sides safe
        require(utab <= mul(u.lockedCollateral, i.priceWithSafetyMargin), "CDPEngine/not-safe-src");
        require(vtab <= mul(v.lockedCollateral, i.priceWithSafetyMargin), "CDPEngine/not-safe-dst");

        // both sides non-debtFloory
        require(either(utab >= i.debtFloor, u.debtShare == 0), "CDPEngine/debtFloor-src");
        require(either(vtab >= i.debtFloor, v.debtShare == 0), "CDPEngine/debtFloor-dst");
    }
    // --- CDP Confiscation ---
    function confiscatePosition(bytes32 collateralIndex, address positionAddress, address collateralOwner, address stablecoinOwner, int collateralValue, int debtShare) external auth {
        Position storage position = positions[collateralIndex][positionAddress];
        CollateralType storage collateralType = collateralTypes[collateralIndex];

        position.lockedCollateral = add(position.lockedCollateral, collateralValue);
        position.debtShare = add(position.debtShare, debtShare);
        collateralType.totalDebtShare = add(collateralType.totalDebtShare, debtShare);

        int debtValue = mul(collateralType.debtAccumulatedRate, debtShare);

        collateralToken[collateralIndex][collateralOwner] = sub(collateralToken[collateralIndex][collateralOwner], collateralValue);
        systemDebt[stablecoinOwner]    = sub(systemDebt[stablecoinOwner],    debtValue);
        totalUnbackedStablecoin      = sub(totalUnbackedStablecoin,      debtValue);
    }

    // --- Settlement ---
    function settleSystemDebt(uint rad) external {
        address u = msg.sender;
        systemDebt[u] = sub(systemDebt[u], rad);
        stablecoin[u] = sub(stablecoin[u], rad);
        totalUnbackedStablecoin   = sub(totalUnbackedStablecoin,   rad);
        totalStablecoinIssued   = sub(totalStablecoinIssued,   rad);
    }
    function mintUnbackedStablecoin(address from, address to, uint rad) external auth {
        systemDebt[from] = add(systemDebt[from], rad);
        stablecoin[to] = add(stablecoin[to], rad);
        totalUnbackedStablecoin   = add(totalUnbackedStablecoin,   rad);
        totalStablecoinIssued   = add(totalStablecoinIssued,   rad);
    }

    // --- Rates ---
    function accrue(bytes32 collateralIndex, address u, int debtAccumulatedRate) external auth {
        require(live == 1, "CDPEngine/not-live");
        CollateralType storage collateralType = collateralTypes[collateralIndex];
        collateralType.debtAccumulatedRate = add(collateralType.debtAccumulatedRate, debtAccumulatedRate);
        int rad  = mul(collateralType.totalDebtShare, debtAccumulatedRate);
        stablecoin[u]   = add(stablecoin[u], rad);
        totalStablecoinIssued     = add(totalStablecoinIssued,   rad);
    }
}
