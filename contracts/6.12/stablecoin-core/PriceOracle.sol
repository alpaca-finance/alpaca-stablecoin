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

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IBookKeeper.sol";
import "../interfaces/IPriceFeed.sol";
import "../interfaces/IPriceOracle.sol";
import "../interfaces/ICagable.sol";
import "../interfaces/ICollateralPoolConfig.sol";

/// @title PriceOracle
/// @author Alpaca Fin Corporation
/** @notice A contract which is the price oracle of the BookKeeper to keep all collateral pools updated with the latest price of the collateral.
    The price oracle is important in reflecting the current state of the market price.
*/

contract PriceOracle is PausableUpgradeable, AccessControlUpgradeable, IPriceOracle, ICagable {
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;
  bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");
  bytes32 public constant SHOW_STOPPER_ROLE = keccak256("SHOW_STOPPER_ROLE");

  // --- Data ---
  struct CollateralPool {
    IPriceFeed priceFeed; // Price Feed
    uint256 liquidationRatio; // Liquidation ratio or Collateral ratio [ray]
  }

  IBookKeeper public bookKeeper; // CDP Engine
  uint256 public override stableCoinReferencePrice; // ref per dai [ray] :: value of stablecoin in the reference asset (e.g. $1 per Alpaca USD)

  uint256 public live;

  // --- Events ---
  event LogSetPrice(
    bytes32 poolId,
    bytes32 rawPrice, // Raw price from price feed [wad]
    uint256 priceWithSafetyMargin // Price with safety margin [ray]
  );

  // --- Init ---
  function initialize(address _bookKeeper) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    IBookKeeper(_bookKeeper).collateralPoolConfig(); // Sanity check call
    bookKeeper = IBookKeeper(_bookKeeper);
    stableCoinReferencePrice = ONE;
    live = 1;

    // Grant the contract deployer the owner role: it will be able
    // to grant and revoke any roles
    _setupRole(OWNER_ROLE, msg.sender);
  }

  // --- Math ---
  uint256 constant ONE = 10**27;

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x);
  }

  function rdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = mul(x, ONE) / y;
  }

  // --- Administration ---
  event LogSetStableCoinReferencePrice(address indexed caller, uint256 data);

  function setStableCoinReferencePrice(uint256 _data) external {
    require(
      bookKeeper.accessControlConfig().hasRole(bookKeeper.accessControlConfig().OWNER_ROLE(), msg.sender),
      "!ownerRole"
    );
    require(live == 1, "Spotter/not-live");
    stableCoinReferencePrice = _data;
    emit LogSetStableCoinReferencePrice(msg.sender, _data);
  }

  // --- Update value ---
  /// @dev Update the latest price with safety margin of the collateral pool to the BookKeeper
  /// @param _collateralPoolId Collateral pool id
  function setPrice(bytes32 _collateralPoolId) external whenNotPaused {
    IPriceFeed priceFeed = bookKeeper.collateralPoolConfig().collateralPools(_collateralPoolId).priceFeed;
    uint256 liquidationRatio = bookKeeper.collateralPoolConfig().collateralPools(_collateralPoolId).liquidationRatio;
    (bytes32 rawPrice, bool hasPrice) = priceFeed.peekPrice();
    uint256 priceWithSafetyMargin = hasPrice
      ? rdiv(rdiv(mul(uint256(rawPrice), 10**9), stableCoinReferencePrice), liquidationRatio)
      : 0;
    bookKeeper.collateralPoolConfig().setPriceWithSafetyMargin(_collateralPoolId, priceWithSafetyMargin);
    emit LogSetPrice(_collateralPoolId, rawPrice, priceWithSafetyMargin);
  }

  function cage() external override {
    require(
      bookKeeper.accessControlConfig().hasRole(bookKeeper.accessControlConfig().OWNER_ROLE(), msg.sender) ||
        bookKeeper.accessControlConfig().hasRole(bookKeeper.accessControlConfig().SHOW_STOPPER_ROLE(), msg.sender),
      "!(ownerRole or showStopperRole)"
    );
    require(live == 1, "PriceOracle/not-live");
    live = 0;
    emit Cage();
  }

  function uncage() external override {
    require(
      bookKeeper.accessControlConfig().hasRole(bookKeeper.accessControlConfig().OWNER_ROLE(), msg.sender) ||
        bookKeeper.accessControlConfig().hasRole(bookKeeper.accessControlConfig().SHOW_STOPPER_ROLE(), msg.sender),
      "!(ownerRole or showStopperRole)"
    );
    require(live == 0, "PriceOracle/not-caged");
    live = 1;
    emit Uncage();
  }

  // --- pause ---
  function pause() external {
    require(
      bookKeeper.accessControlConfig().hasRole(bookKeeper.accessControlConfig().OWNER_ROLE(), msg.sender) ||
        bookKeeper.accessControlConfig().hasRole(bookKeeper.accessControlConfig().GOV_ROLE(), msg.sender),
      "!(ownerRole or govRole)"
    );
    _pause();
  }

  function unpause() external {
    require(
      bookKeeper.accessControlConfig().hasRole(bookKeeper.accessControlConfig().OWNER_ROLE(), msg.sender) ||
        bookKeeper.accessControlConfig().hasRole(bookKeeper.accessControlConfig().GOV_ROLE(), msg.sender),
      "!(ownerRole or govRole)"
    );
    _unpause();
  }
}
