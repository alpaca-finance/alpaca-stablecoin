// SPDX-License-Identifier: AGPL-3.0-or-later

/// systemDebtEngine.sol -- stablecoin settlement module

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

pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "../interfaces/IBookKeeper.sol";
import "../interfaces/ISurplusAuctioneer.sol";
import "../interfaces/IBadDebtAuctioneer.sol";
import "../interfaces/ISystemDebtEngine.sol";
import "../interfaces/IGenericTokenAdapter.sol";

/// @title SystemDebtEngine
/// @author Alpaca Fin Corporation
/** @notice A contract which manages the bad debt and the surplus of the system.
    SystemDebtEngine will be the debitor or debtor when a position is liquidated. 
    The debt recorded in the name of SystemDebtEngine will be considered as system bad debt unless it is cleared by liquidation.
    The stability fee will be accrued and kept within SystemDebtEngine. As it is the debtor, therefore SystemDebtEngine should be the holder of the surplus and use it to settle the bad debt.
*/

contract SystemDebtEngine is
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  ISystemDebtEngine
{
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;
  bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");
  bytes32 public constant LIQUIDATION_ENGINE_ROLE = keccak256("LIQUIDATION_ENGINE_ROLE");
  bytes32 public constant SHOW_STOPPER_ROLE = keccak256("SHOW_STOPPER_ROLE");

  // --- Data ---
  IBookKeeper public bookKeeper; // CDP Engine
  uint256 public surplusBuffer; // Surplus buffer         [rad]
  uint256 public live; // Active Flag

  // --- Init ---
  function initialize(address _bookKeeper) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    bookKeeper = IBookKeeper(_bookKeeper);
    live = 1;

    // Grant the contract deployer the default admin role: it will be able
    // to grant and revoke any roles
    _setupRole(OWNER_ROLE, msg.sender);
  }

  // --- Math ---
  function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x + y) >= x);
  }

  function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x - y) <= x);
  }

  function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
    return x <= y ? x : y;
  }

  // --- withdraw surplus ---
  function withdrawCollateralSurplus(
    bytes32 collateralPoolId,
    IGenericTokenAdapter adapter,
    address to,
    uint256 wad
  ) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    bookKeeper.moveCollateral(collateralPoolId, address(this), to, wad);
    adapter.onMoveCollateral(address(this), to, wad, abi.encode(to));
  }

  function withdrawStablecoinSurplus(address to, uint256 rad) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(
      sub(bookKeeper.stablecoin(address(this)), rad) >= surplusBuffer,
      "SystemDebtEngine/insufficient-surplus-buffer"
    );
    bookKeeper.moveStablecoin(address(this), to, rad);
  }

  // --- Administration ---
  event SetSurplusBuffer(address indexed caller, uint256 data);

  function setSurplusBuffer(uint256 _data) external whenNotPaused {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    surplusBuffer = _data;
    emit SetSurplusBuffer(msg.sender, _data);
  }

  // Debt settlement
  /** @dev Settle system bad debt as SystemDebtEngine.
      This function could be called by anyone to settle the system bad debt when there is available surplus.
      The stablecoin held by SystemDebtEngine (which is the surplus) will be deducted to compensate the incurred bad debt.
  */
  /// @param rad The amount of bad debt to be settled. [rad]
  function settleSystemBadDebt(uint256 rad) external whenNotPaused nonReentrant {
    require(rad <= bookKeeper.stablecoin(address(this)), "SystemDebtEngine/insufficient-surplus");
    require(rad <= bookKeeper.systemBadDebt(address(this)), "SystemDebtEngine/insufficient-debt");
    bookKeeper.settleSystemBadDebt(rad);
  }

  function cage() external override {
    require(
      hasRole(OWNER_ROLE, msg.sender) || hasRole(SHOW_STOPPER_ROLE, msg.sender),
      "!(ownerRole or showStopperRole)"
    );
    require(live == 1, "SystemDebtEngine/not-live");
    live = 0;
    bookKeeper.settleSystemBadDebt(min(bookKeeper.stablecoin(address(this)), bookKeeper.systemBadDebt(address(this))));
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
