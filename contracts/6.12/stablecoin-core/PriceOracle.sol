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
    uint256 liquidationRatio; // Liquidation ratio [ray]
  }

  mapping(bytes32 => CollateralPool) public override collateralPools;

  IBookKeeper public bookKeeper; // CDP Engine
  uint256 public override stableCoinReferencePrice; // ref per dai [ray] :: value of stablecoin in the reference asset (e.g. $1 per Alpaca USD)

  uint256 public live;

  // --- Events ---
  event Poke(
    bytes32 poolId,
    bytes32 val, // [wad]
    uint256 spot // [ray]
  );

  // --- Init ---
  function initialize(address _bookKeeper) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    wards[msg.sender] = 1;
    bookKeeper = IBookKeeper(_bookKeeper);
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
  event SetStableCoinReferencePrice(address indexed caller, uint256 data);
  event SetPriceFeed(address indexed caller, bytes32 poolId, address priceFeed);
  event SetLiquidationRatio(address indexed caller, bytes32 poolId, uint256 data);

  function setStableCoinReferencePrice(uint256 _data) external auth {
    require(live == 1, "Spotter/not-live");
    stableCoinReferencePrice = _data;
    emit SetStableCoinReferencePrice(msg.sender, _data);
  }

  function setPriceFeed(bytes32 _poolId, address _priceFeed) external auth {
    require(live == 1, "Spotter/not-live");
    collateralPools[_poolId].priceFeed = IPriceFeed(_priceFeed);
    emit SetPriceFeed(msg.sender, _poolId, _priceFeed);
  }

  function setLiquidationRatio(bytes32 _poolId, uint256 _data) external auth {
    require(live == 1, "Spotter/not-live");
    collateralPools[_poolId].liquidationRatio = _data;
    emit SetLiquidationRatio(msg.sender, _poolId, _data);
  }

  // --- Update value ---
  function poke(bytes32 poolId) external {
    (bytes32 val, bool has) = collateralPools[poolId].priceFeed.peek();
    uint256 priceWithSafetyMargin = has
      ? rdiv(rdiv(mul(uint256(val), 10**9), stableCoinReferencePrice), collateralPools[poolId].liquidationRatio)
      : 0;
    bookKeeper.setPriceWithSafetyMargin(poolId, priceWithSafetyMargin);
    emit Poke(poolId, val, priceWithSafetyMargin);
  }

  function cage() external override auth {
    live = 0;
  }
}
