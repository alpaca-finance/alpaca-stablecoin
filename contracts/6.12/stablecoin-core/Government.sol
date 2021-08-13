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

contract Government {
    // --- Auth ---
    mapping (address => uint) public whitelist;
    function rely(address usr) external auth { require(live == 1, "Government/not-live"); whitelist[usr] = 1; }
    function deny(address usr) external auth { require(live == 1, "Government/not-live"); whitelist[usr] = 0; }
    modifier auth {
        require(whitelist[msg.sender] == 1, "Government/not-authorized");
        _;
    }

    mapping(address => mapping (address => uint)) public can;
    function hope(address usr) external { can[msg.sender][usr] = 1; }
    function nope(address usr) external { can[msg.sender][usr] = 0; }
    function wish(address bit, address usr) internal view returns (bool) {
        return either(bit == usr, can[bit][usr] == 1);
    }

    // --- Data ---
    struct CollateralPool {
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

    mapping (bytes32 => CollateralPool)                       public collateralPools;
    mapping (bytes32 => mapping (address => Position )) public positions;
    mapping (bytes32 => mapping (address => uint)) public collateralToken;  // [wad]
    mapping (address => uint256)                   public stablecoin;  // [rad]
    mapping (address => uint256)                   public systemBadDebt;  // [rad]

    uint256 public totalStablecoinIssued;  // Total Dai Issued    [rad]
    uint256 public totalUnbackedStablecoin;  // Total Unbacked Dai  [rad]
    uint256 public totalDebtCeiling;  // Total Debt Ceiling  [rad]
    uint256 public live;  // Active Flag

    // --- Init ---
    constructor() public {
        whitelist[msg.sender] = 1;
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
    function init(bytes32 collateralPoolId) external auth {
        require(collateralPools[collateralPoolId].debtAccumulatedRate == 0, "Government/collateral-pool-already-init");
        collateralPools[collateralPoolId].debtAccumulatedRate = 10 ** 27;
    }
    function file(bytes32 what, uint data) external auth {
        require(live == 1, "Government/not-live");
        if (what == "totalDebtCeiling") totalDebtCeiling = data;
        else revert("Government/file-unrecognized-param");
    }
    function file(bytes32 collateralPoolId, bytes32 what, uint data) external auth {
        require(live == 1, "Government/not-live");
        if (what == "priceWithSafetyMargin") collateralPools[collateralPoolId].priceWithSafetyMargin = data;
        else if (what == "debtCeiling") collateralPools[collateralPoolId].debtCeiling = data;
        else if (what == "debtFloor") collateralPools[collateralPoolId].debtFloor = data;
        else revert("Government/file-unrecognized-param");
    }
    function cage() external auth {
        live = 0;
    }

    // --- Fungibility ---
    function addCollateral(bytes32 collateralPoolId, address usr, int256 wad) external auth {
        collateralToken[collateralPoolId][usr] = add(collateralToken[collateralPoolId][usr], wad);
    }
    function moveCollateral(bytes32 collateralPoolId, address src, address dst, uint256 wad) external {
        require(wish(src, msg.sender), "Government/not-allowed");
        collateralToken[collateralPoolId][src] = sub(collateralToken[collateralPoolId][src], wad);
        collateralToken[collateralPoolId][dst] = add(collateralToken[collateralPoolId][dst], wad);
    }
    function moveStablecoin(address src, address dst, uint256 rad) external {
        require(wish(src, msg.sender), "Government/not-allowed");
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
    function adjustPosition(bytes32 collateralPoolId, address positionAddress, address collateralOwner, address stablecoinOwner, int collateralValue, int debtShare) external {
        // system is live
        require(live == 1, "Government/not-live");

        Position memory position = positions[collateralPoolId][positionAddress];
        CollateralPool memory collateralPool = collateralPools[collateralPoolId];
        // collateralPool has been initialised
        require(collateralPool.debtAccumulatedRate != 0, "Government/collateralPool-not-init");

        position.lockedCollateral = add(position.lockedCollateral, collateralValue);
        position.debtShare = add(position.debtShare, debtShare);
        collateralPool.totalDebtShare = add(collateralPool.totalDebtShare, debtShare);

        int debtValue = mul(collateralPool.debtAccumulatedRate, debtShare);
        uint positionDebtValue = mul(collateralPool.debtAccumulatedRate, position.debtShare);
        totalStablecoinIssued     = add(totalStablecoinIssued, debtValue);

        // either debt has decreased, or debt ceilings are not exceeded
        require(either(debtShare <= 0, both(mul(collateralPool.totalDebtShare, collateralPool.debtAccumulatedRate) <= collateralPool.debtCeiling, totalStablecoinIssued <= totalDebtCeiling)), "Government/ceiling-exceeded");
        // position is either less risky than before, or it is safe :: check work factor
        require(either(both(debtShare <= 0, collateralValue >= 0), positionDebtValue <= mul(position.lockedCollateral, collateralPool.priceWithSafetyMargin)), "Government/not-safe");

        // position is either more safe, or the owner consents
        require(either(both(debtShare <= 0, collateralValue >= 0), wish(positionAddress, msg.sender)), "Government/not-allowed-u");
        // collateral src consents
        require(either(collateralValue <= 0, wish(collateralOwner, msg.sender)), "Government/not-allowed-v");
        // debt dst consents
        require(either(debtShare >= 0, wish(stablecoinOwner, msg.sender)), "Government/not-allowed-w");

        // position has no debt, or a non-debtFloory amount
        require(either(position.debtShare == 0, positionDebtValue >= collateralPool.debtFloor), "Government/debtFloor");

        collateralToken[collateralPoolId][collateralOwner] = sub(collateralToken[collateralPoolId][collateralOwner], collateralValue);
        stablecoin[stablecoinOwner]    = add(stablecoin[stablecoinOwner],    debtValue);

        positions[collateralPoolId][positionAddress] = position;
        collateralPools[collateralPoolId]    = collateralPool;
    }
    // --- CDP Fungibility ---
    function movePosition(bytes32 collateralPoolId, address src, address dst, int collateralValue, int debtShare) external {
        Position storage u = positions[collateralPoolId][src];
        Position storage v = positions[collateralPoolId][dst];
        CollateralPool storage i = collateralPools[collateralPoolId];

        u.lockedCollateral = sub(u.lockedCollateral, collateralValue);
        u.debtShare = sub(u.debtShare, debtShare);
        v.lockedCollateral = add(v.lockedCollateral, collateralValue);
        v.debtShare = add(v.debtShare, debtShare);

        uint utab = mul(u.debtShare, i.debtAccumulatedRate);
        uint vtab = mul(v.debtShare, i.debtAccumulatedRate);

        // both sides consent
        require(both(wish(src, msg.sender), wish(dst, msg.sender)), "Government/not-allowed");

        // both sides safe
        require(utab <= mul(u.lockedCollateral, i.priceWithSafetyMargin), "Government/not-safe-src");
        require(vtab <= mul(v.lockedCollateral, i.priceWithSafetyMargin), "Government/not-safe-dst");

        // both sides non-debtFloory
        require(either(utab >= i.debtFloor, u.debtShare == 0), "Government/debtFloor-src");
        require(either(vtab >= i.debtFloor, v.debtShare == 0), "Government/debtFloor-dst");
    }
    // --- CDP Confiscation ---
    function confiscatePosition(bytes32 collateralPoolId, address positionAddress, address collateralCreditor, address stablecoinDebtor, int collateralValue, int debtShare) external auth {
        Position storage position = positions[collateralPoolId][positionAddress];
        CollateralPool storage collateralPool = collateralPools[collateralPoolId];

        position.lockedCollateral = add(position.lockedCollateral, collateralValue);
        position.debtShare = add(position.debtShare, debtShare);
        collateralPool.totalDebtShare = add(collateralPool.totalDebtShare, debtShare);

        int debtValue = mul(collateralPool.debtAccumulatedRate, debtShare);

        collateralToken[collateralPoolId][collateralCreditor] = sub(collateralToken[collateralPoolId][collateralCreditor], collateralValue);
        systemBadDebt[stablecoinDebtor]    = sub(systemBadDebt[stablecoinDebtor],    debtValue);
        totalUnbackedStablecoin      = sub(totalUnbackedStablecoin,      debtValue);
    }

    // --- Settlement ---
    function settleSystemBadDebt(uint rad) external {
        address u = msg.sender;
        systemBadDebt[u] = sub(systemBadDebt[u], rad);
        stablecoin[u] = sub(stablecoin[u], rad);
        totalUnbackedStablecoin   = sub(totalUnbackedStablecoin,   rad);
        totalStablecoinIssued   = sub(totalStablecoinIssued,   rad);
    }
    function mintUnbackedStablecoin(address from, address to, uint rad) external auth {
        systemBadDebt[from] = add(systemBadDebt[from], rad);
        stablecoin[to] = add(stablecoin[to], rad);
        totalUnbackedStablecoin   = add(totalUnbackedStablecoin,   rad);
        totalStablecoinIssued   = add(totalStablecoinIssued,   rad);
    }

    // --- Rates ---
    function accrueStabilityFee(bytes32 collateralPoolId, address u, int debtAccumulatedRate) external auth {
        require(live == 1, "Government/not-live");
        CollateralPool storage collateralPool = collateralPools[collateralPoolId];
        collateralPool.debtAccumulatedRate = add(collateralPool.debtAccumulatedRate, debtAccumulatedRate);
        int rad  = mul(collateralPool.totalDebtShare, debtAccumulatedRate);
        stablecoin[u]   = add(stablecoin[u], rad);
        totalStablecoinIssued     = add(totalStablecoinIssued,   rad);
    }
}
