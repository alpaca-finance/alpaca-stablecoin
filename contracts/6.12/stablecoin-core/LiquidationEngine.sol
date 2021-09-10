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

pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "../interfaces/IBookKeeper.sol";
import "../interfaces/IAuctioneer.sol";
import "../interfaces/ILiquidationEngine.sol";
import "../interfaces/ISystemDebtEngine.sol";

/// @title LiquidationEngine
/// @author Alpaca Fin Corporation
/** @notice A contract which is the manager for all of the liquidations of the protocol.
    LiquidationEngine will be the interface for the liquidator to trigger any positions into the liquidation process.
*/

contract LiquidationEngine is
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  ILiquidationEngine
{
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;
  bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");
  bytes32 public constant AUCTIONEER_ROLE = keccak256("AUCTIONEER_ROLE");
  bytes32 public constant SHOW_STOPPER_ROLE = keccak256("SHOW_STOPPER_ROLE");

  // --- Data ---
  struct CollateralPool {
    address auctioneer; // Auctioneer contract
    uint256 liquidationPenalty; // Liquidation Penalty                                          [wad]
    uint256 liquidationMaxSize; // The maximum amount of liquidated debt value to be put on auction for the collateral pool [rad]
    uint256 stablecoinNeededForDebtRepay; // The current total amount of stablecoin needed to pay back the liquidated positions' debt for the collateral pool [rad]
  }

  IBookKeeper public bookKeeper; // CDP Engine

  mapping(bytes32 => CollateralPool) public override collateralPools;

  ISystemDebtEngine public systemDebtEngine; // Debt Engine
  uint256 public live; // Active Flag
  uint256 public liquidationMaxSize; // The maximum amount of liquidated debt value to be put on auction globally [rad]
  uint256 public stablecoinNeededForDebtRepay; // The current total amount of stablecoin needed to pay back the liquidated positions' debt globally [rad]

  // --- Events ---
  event Rely(address indexed usr);
  event Deny(address indexed usr);

  event File(bytes32 indexed what, uint256 data);
  event File(bytes32 indexed what, address data);
  event File(bytes32 indexed collateralPoolId, bytes32 indexed what, uint256 data);
  event File(bytes32 indexed collateralPoolId, bytes32 indexed what, address auctioneer);

  event StartLiquidation(
    bytes32 indexed collateralPoolId,
    address indexed positionAddress,
    uint256 collateralAmountToBeLiquidated,
    uint256 debtShareToBeLiquidated,
    uint256 debtValueToBeLiquidatedWithoutPenalty,
    address auctioneer,
    uint256 indexed id
  );
  event RemoveRepaidDebtFromAuction(bytes32 indexed collateralPoolId, uint256 rad);
  event Cage();

  // --- Init ---
  function initialize(address _bookKeeper) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    bookKeeper = IBookKeeper(_bookKeeper);
    live = 1;
    emit Rely(msg.sender);

    // Grant the contract deployer the default admin role: it will be able
    // to grant and revoke any roles
    _setupRole(OWNER_ROLE, msg.sender);
  }

  // --- Math ---
  uint256 constant WAD = 10**18;

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
  function file(bytes32 what, address data) external {
    if (what == "systemDebtEngine") systemDebtEngine = ISystemDebtEngine(data);
    else revert("LiquidationEngine/file-unrecognized-param");
    emit File(what, data);
  }

  function file(bytes32 what, uint256 data) external {
    if (what == "liquidationMaxSize") liquidationMaxSize = data;
    else revert("LiquidationEngine/file-unrecognized-param");
    emit File(what, data);
  }

  function file(
    bytes32 collateralPoolId,
    bytes32 what,
    uint256 data
  ) external {
    if (what == "liquidationPenalty") {
      require(data >= WAD, "LiquidationEngine/file-liquidationPenalty-lt-WAD");
      collateralPools[collateralPoolId].liquidationPenalty = data;
    } else if (what == "liquidationMaxSize") collateralPools[collateralPoolId].liquidationMaxSize = data;
    else revert("LiquidationEngine/file-unrecognized-param");
    emit File(collateralPoolId, what, data);
  }

  function file(
    bytes32 collateralPoolId,
    bytes32 what,
    address auctioneer
  ) external {
    if (what == "auctioneer") {
      require(
        collateralPoolId == IAuctioneer(auctioneer).collateralPoolId(),
        "LiquidationEngine/file-collateralPoolId-neq-auctioneer.collateralPoolId"
      );
      collateralPools[collateralPoolId].auctioneer = auctioneer;
    } else revert("LiquidationEngine/file-unrecognized-param");
    emit File(collateralPoolId, what, auctioneer);
  }

  function liquidationPenalty(bytes32 collateralPoolId) external view override returns (uint256) {
    return collateralPools[collateralPoolId].liquidationPenalty;
  }

  // --- CDP Liquidation: all bark and no bite ---
  //
  // Liquidate a Vault and start a Dutch auction to sell its collateral for DAI.
  //
  // The third argument is the address that will receive the liquidation reward, if any.
  //
  // The entire Vault will be liquidated except when the target amount of DAI to be raised in
  // the resulting auction (debt of Vault + liquidation penalty) causes either stablecoinNeededForDebtRepay to exceed
  // liquidationMaxSize or collateralPool.stablecoinNeededForDebtRepay to exceed collateralPool.liquidationMaxSize by an economically significant amount. In that
  // case, a partial liquidation is performed to respect the global and per-collateralPool limits on
  // outstanding DAI target. The one exception is if the resulting auction would likely
  // have too little collateral to be interesting to Keepers (debt taken from Vault < collateralPool.debtFloor),
  // in which case the function reverts. Please refer to the code and comments within if
  // more detail is desired.
  function startLiquidation(
    bytes32 collateralPoolId,
    address positionAddress,
    address liquidatorAddress
  ) external nonReentrant returns (uint256 id) {
    require(live == 1, "LiquidationEngine/not-live");

    (uint256 positionLockedCollateral, uint256 positionDebtShare) = bookKeeper.positions(
      collateralPoolId,
      positionAddress
    );
    CollateralPool memory mcollateralPool = collateralPools[collateralPoolId];
    uint256 debtShareToBeLiquidated;
    uint256 debtAccumulatedRate;
    uint256 debtFloor;
    {
      uint256 priceWithSafetyMargin;
      (, debtAccumulatedRate, priceWithSafetyMargin, , debtFloor) = bookKeeper.collateralPools(collateralPoolId);
      require(
        priceWithSafetyMargin > 0 &&
          mul(positionLockedCollateral, priceWithSafetyMargin) < mul(positionDebtShare, debtAccumulatedRate),
        "LiquidationEngine/not-unsafe"
      );

      // Get the minimum value between:
      // 1) Remaining space in the general liquidationMaxSize
      // 2) Remaining space in the collateral liquidationMaxSize
      require(
        liquidationMaxSize > stablecoinNeededForDebtRepay &&
          mcollateralPool.liquidationMaxSize > mcollateralPool.stablecoinNeededForDebtRepay,
        "LiquidationEngine/liquidation-limit-hit"
      );
      uint256 room = min(
        liquidationMaxSize - stablecoinNeededForDebtRepay,
        mcollateralPool.liquidationMaxSize - mcollateralPool.stablecoinNeededForDebtRepay
      );

      // uint256.max()/(RAD*WAD) = 115,792,089,237,316
      debtShareToBeLiquidated = min(
        positionDebtShare,
        mul(room, WAD) / debtAccumulatedRate / mcollateralPool.liquidationPenalty
      );

      // Partial liquidation edge case logic
      if (positionDebtShare > debtShareToBeLiquidated) {
        if (mul(positionDebtShare - debtShareToBeLiquidated, debtAccumulatedRate) < debtFloor) {
          // If the leftover Vault would be debtFloory, just liquidate it entirely.
          // This will result in at least one of stablecoinNeededForDebtRepay_i > liquidationMaxSize_i or stablecoinNeededForDebtRepay > liquidationMaxSize becoming true.
          // The amount of excess will be bounded above by ceiling(debtFloor_i * liquidationPenalty_i / WAD).
          // This deviation is assumed to be small compared to both liquidationMaxSize_i and liquidationMaxSize, so that
          // the extra amount of target DAI over the limits intended is not of economic concern.
          debtShareToBeLiquidated = positionDebtShare;
        } else {
          // In a partial liquidation, the resulting auction should also be non-debtFloory.
          require(
            mul(debtShareToBeLiquidated, debtAccumulatedRate) >= debtFloor,
            "LiquidationEngine/debtFloory-auction-from-partial-liquidation"
          );
        }
      }
    }

    uint256 collateralAmountToBeLiquidated = mul(positionLockedCollateral, debtShareToBeLiquidated) / positionDebtShare;

    require(collateralAmountToBeLiquidated > 0, "LiquidationEngine/null-auction");
    require(
      debtShareToBeLiquidated <= 2**255 && collateralAmountToBeLiquidated <= 2**255,
      "LiquidationEngine/overflow"
    );

    bookKeeper.confiscatePosition(
      collateralPoolId,
      positionAddress,
      mcollateralPool.auctioneer,
      address(systemDebtEngine),
      -int256(collateralAmountToBeLiquidated),
      -int256(debtShareToBeLiquidated)
    );

    uint256 debtValueToBeLiquidatedWithoutPenalty = mul(debtShareToBeLiquidated, debtAccumulatedRate);

    // This line is omitted, because there will be no Bad Debt Auction.
    // Thus, having Bad Debt Queue does not make sense and would prevent settling of Bad Debt to be done with efficient gas.
    //systemDebtEngine.pushToBadDebtQueue(debtValueToBeLiquidatedWithoutPenalty);

    {
      // Avoid stack too deep
      // This calcuation will overflow if debtShareToBeLiquidated*debtAccumulatedRate exceeds ~10^14
      uint256 debtValueToBeLiquidatedWithPenalty = mul(
        debtValueToBeLiquidatedWithoutPenalty,
        mcollateralPool.liquidationPenalty
      ) / WAD;
      stablecoinNeededForDebtRepay = add(stablecoinNeededForDebtRepay, debtValueToBeLiquidatedWithPenalty);
      collateralPools[collateralPoolId].stablecoinNeededForDebtRepay = add(
        mcollateralPool.stablecoinNeededForDebtRepay,
        debtValueToBeLiquidatedWithPenalty
      );

      id = IAuctioneer(mcollateralPool.auctioneer).startAuction({
        debt: debtValueToBeLiquidatedWithPenalty,
        collateralAmount: collateralAmountToBeLiquidated,
        positionAddress: positionAddress,
        liquidatorAddress: liquidatorAddress
      });
    }

    emit StartLiquidation(
      collateralPoolId,
      positionAddress,
      collateralAmountToBeLiquidated,
      debtShareToBeLiquidated,
      debtValueToBeLiquidatedWithoutPenalty,
      mcollateralPool.auctioneer,
      id
    );
  }

  /// @dev Remove debt from the system when it is already paid by the liquidator
  /// @param collateralPoolId Collateral pool id
  /// @param rad The debt value to be removed
  function removeRepaidDebtFromAuction(bytes32 collateralPoolId, uint256 rad) external override {
    require(hasRole(AUCTIONEER_ROLE, msg.sender), "!auctioneerRole");
    stablecoinNeededForDebtRepay = sub(stablecoinNeededForDebtRepay, rad);
    collateralPools[collateralPoolId].stablecoinNeededForDebtRepay = sub(
      collateralPools[collateralPoolId].stablecoinNeededForDebtRepay,
      rad
    );
    emit RemoveRepaidDebtFromAuction(collateralPoolId, rad);
  }

  function cage() external override {
    require(
      hasRole(OWNER_ROLE, msg.sender) || hasRole(SHOW_STOPPER_ROLE, msg.sender),
      "!ownerRole or !showStopperRole"
    );
    live = 0;
    emit Cage();
  }

  // --- pause ---
  function pause() external {
    require(hasRole(OWNER_ROLE, msg.sender) || hasRole(GOV_ROLE, msg.sender), "!ownerRole or !govRole");
    _pause();
  }

  function unpause() external {
    require(hasRole(OWNER_ROLE, msg.sender) || hasRole(GOV_ROLE, msg.sender), "!ownerRole or !govRole");
    _unpause();
  }
}
