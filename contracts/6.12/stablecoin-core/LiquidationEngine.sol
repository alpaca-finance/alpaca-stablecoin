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
import "../interfaces/ILiquidationStrategy.sol";

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

  mapping(bytes32 => address) public override strategies; // Liquidation strategy for each collateral pool

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

  function liquidate(
    bytes32 collateralPoolId,
    address positionAddress,
    uint256 debtShareToRepay,
    bytes calldata data
  ) external nonReentrant returns (uint256 id) {
    require(live == 1, "LiquidationEngine/not-live");

    (uint256 positionLockedCollateral, uint256 positionDebtShare) = bookKeeper.positions(
      collateralPoolId,
      positionAddress
    );
    address strategy = strategies[collateralPoolId];
    uint256 debtAccumulatedRate;
    uint256 debtFloor;
    {
      // 1. Check if the position is underwater
      uint256 priceWithSafetyMargin;
      (, debtAccumulatedRate, priceWithSafetyMargin, , debtFloor) = bookKeeper.collateralPools(collateralPoolId);
      require(
        priceWithSafetyMargin > 0 &&
          mul(positionLockedCollateral, priceWithSafetyMargin) < mul(positionDebtShare, debtAccumulatedRate),
        "LiquidationEngine/not-unsafe"
      );
    }

    ILiquidationStrategy(strategy).execute(
      collateralPoolId,
      positionDebtShare,
      positionLockedCollateral,
      positionAddress,
      debtShareToRepay,
      data
    );
  }

  function cage() external override {
    require(
      hasRole(OWNER_ROLE, msg.sender) || hasRole(SHOW_STOPPER_ROLE, msg.sender),
      "!(ownerRole or showStopperRole)"
    );
    live = 0;
    emit Cage();
  }

  // --- pause ---
  function pause() external {
    require(hasRole(OWNER_ROLE, msg.sender) || hasRole(GOV_ROLE, msg.sender), "!(ownerRole or govRole)");
    _pause();
  }

  function unpause() external {
    require(hasRole(OWNER_ROLE, msg.sender) || hasRole(GOV_ROLE, msg.sender), "!(ownerRole or govRole)");
    _unpause();
  }
}
