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

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IBookKeeper.sol";
import "../interfaces/IPriceFeed.sol";
import "../interfaces/IPriceOracle.sol";

// FIXME: This contract was altered compared to the production version.
// It doesn't use LibNote anymore.
// New deployments of this contract will need to include custom events (TO DO).

contract PriceOracle is OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable, IPriceOracle {
  // --- Auth ---
  mapping(address => uint256) public wards;

  function rely(address guy) external auth {
    wards[guy] = 1;
  }

  function deny(address guy) external auth {
    wards[guy] = 0;
  }

  modifier auth() {
    require(wards[msg.sender] == 1, "Spotter/not-authorized");
    _;
  }

  // --- Data ---
  struct CollateralPool {
    IPriceFeed priceFeed; // Price Feed
    uint256 liquidationRatio; // Liquidation ratio or Collateral ratio [ray]
  }

  mapping(bytes32 => CollateralPool) public override collateralPools;

  IBookKeeper public bookKeeper;
  uint256 public override stableCoinReferencePrice; // ref per dai [ray] :: value of stablecoin in the reference asset (e.g. $1 per Alpaca USD)

  uint256 public live;

  // --- Events ---
  event Poke(
    bytes32 poolId,
    bytes32 rawPrice, // Raw price from price feed [wad]
    uint256 priceWithSafetyMargin // Price with safety margin [ray]
  );

  // --- Init ---
  function initialize(address bookKeeper_) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    wards[msg.sender] = 1;
    bookKeeper = IBookKeeper(bookKeeper_);
    stableCoinReferencePrice = ONE;
    live = 1;
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
  function file(
    bytes32 poolId,
    bytes32 what,
    address priceFeed_
  ) external auth {
    require(live == 1, "Spotter/not-live");
    if (what == "priceFeed") collateralPools[poolId].priceFeed = IPriceFeed(priceFeed_);
    else revert("Spotter/file-unrecognized-param");
  }

  function file(bytes32 what, uint256 data) external auth {
    require(live == 1, "Spotter/not-live");
    if (what == "stableCoinReferencePrice") stableCoinReferencePrice = data;
    else revert("Spotter/file-unrecognized-param");
  }

  function file(
    bytes32 poolId,
    bytes32 what,
    uint256 data
  ) external auth {
    require(live == 1, "Spotter/not-live");
    if (what == "liquidationRatio") collateralPools[poolId].liquidationRatio = data;
    else revert("Spotter/file-unrecognized-param");
  }

  // --- Update value ---
  /// @dev Update the latest price with safety margin of the collateral pool to the BookKeeper
  /// @param poolId Collateral pool id
  function poke(bytes32 poolId) external {
    (bytes32 rawPrice, bool hasPrice) = collateralPools[poolId].priceFeed.peek();
    uint256 priceWithSafetyMargin = hasPrice
      ? rdiv(rdiv(mul(uint256(rawPrice), 10**9), stableCoinReferencePrice), collateralPools[poolId].liquidationRatio)
      : 0;
    bookKeeper.file(poolId, "priceWithSafetyMargin", priceWithSafetyMargin);
    emit Poke(poolId, rawPrice, priceWithSafetyMargin);
  }

  function cage() external override auth {
    live = 0;
  }
}
