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
import "../interfaces/ISystemDebtEngine.sol";
import "../interfaces/IGenericTokenAdapter.sol";
import "../interfaces/ICagable.sol";

/// @title SystemDebtEngine
/// @author Alpaca Fin Corporation
/** @notice A contract which manages the bad debt and the surplus of the system.
    SystemDebtEngine will be the debitor or debtor when a position is liquidated. 
    The debt recorded in the name of SystemDebtEngine will be considered as system bad debt unless it is cleared by liquidation.
    The stability fee will be accrued and kept within SystemDebtEngine. As it is the debtor, therefore SystemDebtEngine should be the holder of the surplus and use it to settle the bad debt.
*/

contract SystemDebtEngine is PausableUpgradeable, ReentrancyGuardUpgradeable, ISystemDebtEngine, ICagable {
  bytes32 public constant OWNER_ROLE = 0x00;

  // --- Data ---
  IBookKeeper public bookKeeper; // CDP Engine
  uint256 public surplusBuffer; // Surplus buffer         [rad]
  uint256 public live; // Active Flag

  // --- Init ---
  function initialize(address _bookKeeper) external initializer {
    PausableUpgradeable.__Pausable_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    bookKeeper = IBookKeeper(_bookKeeper);
    live = 1;
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
  /// @param amount The amount of collateral. [wad]
  function withdrawCollateralSurplus(
    bytes32 collateralPoolId,
    IGenericTokenAdapter adapter,
    address to,
    uint256 amount // [wad]
  ) external {
    require(bookKeeper.accessControlConfigHasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    bookKeeper.moveCollateral(collateralPoolId, address(this), to, amount);
    adapter.onMoveCollateral(address(this), to, amount, abi.encode(to));
  }

  /// @param value The value of collateral. [rad]
  function withdrawStablecoinSurplus(address to, uint256 value) external {
    require(bookKeeper.accessControlConfigHasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(sub(bookKeeper.stablecoin(address(this)), value) >= surplusBuffer, "SystemDebtEngine/insufficient-surplus");
    bookKeeper.moveStablecoin(address(this), to, value);
  }

  // --- Administration ---
  event SetSurplusBuffer(address indexed caller, uint256 data);

  function setSurplusBuffer(uint256 _data) external whenNotPaused {
    require(bookKeeper.accessControlConfigHasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    surplusBuffer = _data;
    emit SetSurplusBuffer(msg.sender, _data);
  }

  // Debt settlement
  /** @dev Settle system bad debt as SystemDebtEngine.
      This function could be called by anyone to settle the system bad debt when there is available surplus.
      The stablecoin held by SystemDebtEngine (which is the surplus) will be deducted to compensate the incurred bad debt.
  */
  /// @param value The value of bad debt to be settled. [rad]
  function settleSystemBadDebt(uint256 value) external override whenNotPaused nonReentrant {
    require(value <= bookKeeper.stablecoin(address(this)), "SystemDebtEngine/insufficient-surplus");
    require(value <= bookKeeper.systemBadDebt(address(this)), "SystemDebtEngine/insufficient-debt");
    bookKeeper.settleSystemBadDebt(value);
  }

  function cage() external override {
    require(
      bookKeeper.accessControlConfigHasRole(OWNER_ROLE, msg.sender) ||
        bookKeeper.accessControlConfigHasRole(bookKeeper.accessControlConfig().SHOW_STOPPER_ROLE(), msg.sender),
      "!(ownerRole or showStopperRole)"
    );
    require(live == 1, "SystemDebtEngine/not-live");
    live = 0;
    bookKeeper.settleSystemBadDebt(min(bookKeeper.stablecoin(address(this)), bookKeeper.systemBadDebt(address(this))));
    emit Cage();
  }

  function uncage() external override {
    require(
      bookKeeper.accessControlConfigHasRole(OWNER_ROLE, msg.sender) ||
        bookKeeper.accessControlConfigHasRole(bookKeeper.accessControlConfig().SHOW_STOPPER_ROLE(), msg.sender),
      "!(ownerRole or showStopperRole)"
    );
    require(live == 0, "SystemDebtEngine/not-caged");
    live = 1;
    emit Uncage();
  }

  // --- pause ---
  function pause() external {
    require(
      bookKeeper.accessControlConfigHasRole(OWNER_ROLE, msg.sender) ||
        bookKeeper.accessControlConfigHasRole(bookKeeper.accessControlConfig().GOV_ROLE(), msg.sender),
      "!(ownerRole or govRole)"
    );
    _pause();
  }

  function unpause() external {
    require(
      bookKeeper.accessControlConfigHasRole(OWNER_ROLE, msg.sender) ||
        bookKeeper.accessControlConfigHasRole(bookKeeper.accessControlConfig().GOV_ROLE(), msg.sender),
      "!(ownerRole or govRole)"
    );
    _unpause();
  }
}
