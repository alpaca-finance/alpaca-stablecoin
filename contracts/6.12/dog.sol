// SPDX-License-Identifier: AGPL-3.0-or-later

/// dog.sol -- Dai liquidation module 2.0

// Copyright (C) 2020-2021 Maker Ecosystem Growth Holdings, INC.
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

pragma solidity >=0.6.12;

interface ClipperLike {
    function collateralType() external view returns (bytes32);
    function kick(
        uint256 tab,
        uint256 lot,
        address usr,
        address kpr
    ) external returns (uint256);
}

interface CDPEngineLike {
    function collateralTypes(bytes32) external view returns (
        uint256 Art,  // [wad]
        uint256 debtAccumulatedRate, // [ray]
        uint256 priceWithSafetyMargin, // [ray]
        uint256 line, // [rad]
        uint256 debtFloor  // [rad]
    );
    function positions(bytes32,address) external view returns (
        uint256 lockedCollateral,  // [wad]
        uint256 debtShare   // [wad]
    );
    function confiscate(bytes32,address,address,address,int256,int256) external;
    function hope(address) external;
    function nope(address) external;
}

interface VowLike {
    function fess(uint256) external;
}

contract LiquidationEngine {
    // --- Auth ---
    mapping (address => uint256) public whitelist;
    function rely(address usr) external auth { whitelist[usr] = 1; emit Rely(usr); }
    function deny(address usr) external auth { whitelist[usr] = 0; emit Deny(usr); }
    modifier auth {
        require(whitelist[msg.sender] == 1, "LiquidationEngine/not-authorized");
        _;
    }

    // --- Data ---
    struct CollateralType {
        address clip;  // Liquidator
        uint256 liquidationPenalty;  // Liquidation Penalty                                          [wad]
        uint256 maxStablecoinNeeded;  // Max DAI needed to cover debt+fees of active auctions per collateralType [rad]
        uint256 amountStablecoinNeeded;  // Amt DAI needed to cover debt+fees of active auctions per collateralType [rad]
    }

    CDPEngineLike immutable public cdpEngine;  // CDP Engine

    mapping (bytes32 => CollateralType) public collateralTypes;

    VowLike public vow;   // Debt Engine
    uint256 public live;  // Active Flag
    uint256 public maxStablecoinNeeded;  // Max DAI needed to cover debt+fees of active auctions [rad]
    uint256 public amountStablecoinNeeded;  // Amt DAI needed to cover debt+fees of active auctions [rad]

    // --- Events ---
    event Rely(address indexed usr);
    event Deny(address indexed usr);

    event File(bytes32 indexed what, uint256 data);
    event File(bytes32 indexed what, address data);
    event File(bytes32 indexed collateralType, bytes32 indexed what, uint256 data);
    event File(bytes32 indexed collateralType, bytes32 indexed what, address clip);

    event Bark(
      bytes32 indexed collateralType,
      address indexed urn,
      uint256 ink,
      uint256 art,
      uint256 due,
      address clip,
      uint256 indexed id
    );
    event Digs(bytes32 indexed collateralType, uint256 rad);
    event Cage();

    // --- Init ---
    constructor(address cdpEngine_) public {
        cdpEngine = CDPEngineLike(cdpEngine_);
        live = 1;
        whitelist[msg.sender] = 1;
        emit Rely(msg.sender);
    }

    // --- Math ---
    uint256 constant WAD = 10 ** 18;

    function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = x <= y ? x : y;
    }
    function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require((z = x + y) >= x);
    }
    function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require((z = x - y) <= x);
    }
    function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require(y == 0 || (z = x * y) / y == x);
    }

    // --- Administration ---
    function file(bytes32 what, address data) external auth {
        if (what == "vow") vow = VowLike(data);
        else revert("LiquidationEngine/file-unrecognized-param");
        emit File(what, data);
    }
    function file(bytes32 what, uint256 data) external auth {
        if (what == "maxStablecoinNeeded") maxStablecoinNeeded = data;
        else revert("LiquidationEngine/file-unrecognized-param");
        emit File(what, data);
    }
    function file(bytes32 collateralType, bytes32 what, uint256 data) external auth {
        if (what == "liquidationPenalty") {
            require(data >= WAD, "LiquidationEngine/file-liquidationPenalty-lt-WAD");
            collateralTypes[collateralType].liquidationPenalty = data;
        } else if (what == "maxStablecoinNeeded") collateralTypes[collateralType].maxStablecoinNeeded = data;
        else revert("LiquidationEngine/file-unrecognized-param");
        emit File(collateralType, what, data);
    }
    function file(bytes32 collateralType, bytes32 what, address clip) external auth {
        if (what == "clip") {
            require(collateralType == ClipperLike(clip).collateralType(), "LiquidationEngine/file-collateralType-neq-clip.collateralType");
            collateralTypes[collateralType].clip = clip;
        } else revert("LiquidationEngine/file-unrecognized-param");
        emit File(collateralType, what, clip);
    }

    function liquidationPenalty(bytes32 collateralType) external view returns (uint256) {
        return collateralTypes[collateralType].liquidationPenalty;
    }

    // --- CDP Liquidation: all bark and no bite ---
    //
    // Liquidate a Vault and start a Dutch auction to sell its collateral for DAI.
    //
    // The third argument is the address that will receive the liquidation reward, if any.
    //
    // The entire Vault will be liquidated except when the target amount of DAI to be raised in
    // the resulting auction (debt of Vault + liquidation penalty) causes either amountStablecoinNeeded to exceed
    // maxStablecoinNeeded or collateralType.amountStablecoinNeeded to exceed collateralType.maxStablecoinNeeded by an economically significant amount. In that
    // case, a partial liquidation is performed to respect the global and per-collateralType limits on
    // outstanding DAI target. The one exception is if the resulting auction would likely
    // have too little collateral to be interesting to Keepers (debt taken from Vault < collateralType.debtFloor),
    // in which case the function reverts. Please refer to the code and comments within if
    // more detail is desired.
    function bark(bytes32 collateralType, address positionAddress, address keeperAddress) external returns (uint256 id) {
        require(live == 1, "LiquidationEngine/not-live");

        (uint256 positionLockedCollateral, uint256 positionDebtShare) = cdpEngine.positions(collateralType, positionAddress);
        CollateralType memory mcollateralType = collateralTypes[collateralType];
        uint256 debtShareToBeLiquidated;
        uint256 debtAccumulatedRate;
        uint256 debtFloor;
        {
            uint256 priceWithSafetyMargin;
            (,debtAccumulatedRate, priceWithSafetyMargin,, debtFloor) = cdpEngine.collateralTypes(collateralType);
            require(priceWithSafetyMargin > 0 && mul(positionLockedCollateral, priceWithSafetyMargin) < mul(positionDebtShare, debtAccumulatedRate), "LiquidationEngine/not-unsafe");

            // Get the minimum value between:
            // 1) Remaining space in the general maxStablecoinNeeded
            // 2) Remaining space in the collateral maxStablecoinNeeded
            require(maxStablecoinNeeded > amountStablecoinNeeded && mcollateralType.maxStablecoinNeeded > mcollateralType.amountStablecoinNeeded, "LiquidationEngine/liquidation-limit-hit");
            uint256 room = min(maxStablecoinNeeded - amountStablecoinNeeded, mcollateralType.maxStablecoinNeeded - mcollateralType.amountStablecoinNeeded);

            // uint256.max()/(RAD*WAD) = 115,792,089,237,316
            debtShareToBeLiquidated = min(positionDebtShare, mul(room, WAD) / debtAccumulatedRate / mcollateralType.liquidationPenalty);

            // Partial liquidation edge case logic
            if (positionDebtShare > debtShareToBeLiquidated) {
                if (mul(positionDebtShare - debtShareToBeLiquidated, debtAccumulatedRate) < debtFloor) {

                    // If the leftover Vault would be debtFloory, just liquidate it entirely.
                    // This will result in at least one of amountStablecoinNeeded_i > maxStablecoinNeeded_i or amountStablecoinNeeded > maxStablecoinNeeded becoming true.
                    // The amount of excess will be bounded above by ceiling(debtFloor_i * liquidationPenalty_i / WAD).
                    // This deviation is assumed to be small compared to both maxStablecoinNeeded_i and maxStablecoinNeeded, so that
                    // the extra amount of target DAI over the limits intended is not of economic concern.
                    debtShareToBeLiquidated = positionDebtShare;
                } else {

                    // In a partial liquidation, the resulting auction should also be non-debtFloory.
                    require(mul(debtShareToBeLiquidated, debtAccumulatedRate) >= debtFloor, "LiquidationEngine/debtFloory-auction-from-partial-liquidation");
                }
            }
        }

        uint256 collateralAmountToBeLiquidated = mul(positionLockedCollateral, debtShareToBeLiquidated) / positionDebtShare;

        require(collateralAmountToBeLiquidated > 0, "LiquidationEngine/null-auction");
        require(debtShareToBeLiquidated <= 2**255 && collateralAmountToBeLiquidated <= 2**255, "LiquidationEngine/overflow");

        cdpEngine.confiscate(
            collateralType, positionAddress, mcollateralType.clip, address(vow), -int256(collateralAmountToBeLiquidated), -int256(debtShareToBeLiquidated)
        );

        uint256 debtValueToBeLiquidatedWithoutPenalty = mul(debtShareToBeLiquidated, debtAccumulatedRate);
        vow.fess(debtValueToBeLiquidatedWithoutPenalty);

        {   // Avoid stack too deep
            // This calcuation will overflow if debtShareToBeLiquidated*debtAccumulatedRate exceeds ~10^14
            uint256 debtValueToBeLiquidatedWithPenalty = mul(debtValueToBeLiquidatedWithoutPenalty, mcollateralType.liquidationPenalty) / WAD;
            amountStablecoinNeeded = add(amountStablecoinNeeded, debtValueToBeLiquidatedWithPenalty);
            collateralTypes[collateralType].amountStablecoinNeeded = add(mcollateralType.amountStablecoinNeeded, debtValueToBeLiquidatedWithPenalty);

            id = ClipperLike(mcollateralType.clip).kick({
                tab: debtValueToBeLiquidatedWithPenalty,
                lot: collateralAmountToBeLiquidated,
                usr: positionAddress,
                kpr: keeperAddress
            });
        }

        emit Bark(collateralType, positionAddress, collateralAmountToBeLiquidated, debtShareToBeLiquidated, debtValueToBeLiquidatedWithoutPenalty, mcollateralType.clip, id);
    }

    function digs(bytes32 collateralType, uint256 rad) external auth {
        amountStablecoinNeeded = sub(amountStablecoinNeeded, rad);
        collateralTypes[collateralType].amountStablecoinNeeded = sub(collateralTypes[collateralType].amountStablecoinNeeded, rad);
        emit Digs(collateralType, rad);
    }

    function cage() external auth {
        live = 0;
        emit Cage();
    }
}
