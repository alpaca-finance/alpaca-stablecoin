// SPDX-License-Identifier: AGPL-3.0-or-later

/// BookKeeper.sol -- stable coin CDP database

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

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "../interfaces/IBookKeeper.sol";

// FIXME: This contract was altered compared to the production version.
// It doesn't use LibNote anymore.
// New deployments of this contract will need to include custom events (TO DO).

contract BookKeeper is IBookKeeper, OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable {
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;
  bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");
  bytes32 public constant PRICE_ORACLE_ROLE = keccak256("PRICE_ORACLE_ROLE");
  bytes32 public constant ADAPTER_ROLE = keccak256("ADAPTER_ROLE");
  bytes32 public constant LIQUIDATION_ENGINE_ROLE = keccak256("LIQUIDATION_ENGINE_ROLE");
  bytes32 public constant AUCTIONEER_ROLE = keccak256("AUCTIONEER_ROLE");
  bytes32 public constant STABILITY_FEE_COLLECTOR_ROLE = keccak256("STABILITY_FEE_COLLECTOR_ROLE");
  bytes32 public constant SHOW_STOPPER_ROLE = keccak256("SHOW_STOPPER_ROLE");
  bytes32 public constant POSITION_MANAGER_ROLE = keccak256("POSITION_MANAGER_ROLE");

  // --- Auth ---
  mapping(address => uint256) public whitelist;

  function rely(address usr) external auth {
    require(live == 1, "BookKeeper/not-live");
    whitelist[usr] = 1;
  }

  function deny(address usr) external auth {
    require(live == 1, "BookKeeper/not-live");
    whitelist[usr] = 0;
  }

  function pause() external {
    require(hasRole(OWNER_ROLE, msg.sender) || hasRole(GOV_ROLE, msg.sender), "!ownerRole or !govRole");
    _pause();
  }

  function unpause() external {
    require(hasRole(OWNER_ROLE, msg.sender) || hasRole(GOV_ROLE, msg.sender), "!ownerRole or !govRole");
    _unpause();
  }

  modifier auth() {
    require(whitelist[msg.sender] == 1, "BookKeeper/not-authorized");
    _;
  }

  mapping(address => mapping(address => uint256)) public override can;

  function hope(address usr) external override whenNotPaused {
    can[msg.sender][usr] = 1;
  }

  function nope(address usr) external override whenNotPaused {
    can[msg.sender][usr] = 0;
  }

  function wish(address bit, address usr) internal view returns (bool) {
    return either(bit == usr, can[bit][usr] == 1);
  }

  // --- Data ---
  struct CollateralPool {
    uint256 totalDebtShare; // Total Normalised Debt     [wad]
    uint256 debtAccumulatedRate; // Accumulated Rates         [ray]
    uint256 priceWithSafetyMargin; // Price with Safety Margin  [ray]
    uint256 debtCeiling; // Debt Ceiling              [rad]
    uint256 debtFloor; // Position Debt Floor            [rad]
  }
  struct Position {
    uint256 lockedCollateral; // Locked Collateral  [wad]
    uint256 debtShare; // Normalised Debt    [wad]
  }

  mapping(bytes32 => CollateralPool) public override collateralPools;
  mapping(bytes32 => mapping(address => Position)) public override positions;
  mapping(bytes32 => mapping(address => uint256)) public override collateralToken; // [wad]
  mapping(address => uint256) public override stablecoin; // [rad]
  mapping(address => uint256) public override systemBadDebt; // [rad]

  uint256 public override totalStablecoinIssued; // Total stable coin Issued    [rad]
  uint256 public totalUnbackedStablecoin; // Total Unbacked stable coin  [rad]
  uint256 public totalDebtCeiling; // Total Debt Ceiling  [rad]
  uint256 public live; // Active Flag

  // --- Init ---
  function initialize() external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    whitelist[msg.sender] = 1;
    live = 1;

    // Grant the contract deployer the default admin role: it will be able
    // to grant and revoke any roles
    _setupRole(OWNER_ROLE, msg.sender);
  }

  // --- Math ---
  function add(uint256 x, int256 y) internal pure returns (uint256 z) {
    z = x + uint256(y);
    require(y >= 0 || z <= x);
    require(y <= 0 || z >= x);
  }

  function sub(uint256 x, int256 y) internal pure returns (uint256 z) {
    z = x - uint256(y);
    require(y <= 0 || z <= x);
    require(y >= 0 || z >= x);
  }

  function mul(uint256 x, int256 y) internal pure returns (int256 z) {
    z = int256(x) * y;
    require(int256(x) >= 0);
    require(y == 0 || z / y == int256(x));
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
  function init(bytes32 collateralPoolId) external whenNotPaused {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(collateralPools[collateralPoolId].debtAccumulatedRate == 0, "BookKeeper/collateral-pool-already-init");
    collateralPools[collateralPoolId].debtAccumulatedRate = 10**27;
  }

  event SetTotalDebtCeiling(address indexed caller, uint256 data);
  event SetPriceWithSafetyMargin(address indexed caller, bytes32 collateralPoolId, uint256 data);
  event SetDebtCeiling(address indexed caller, bytes32 collateralPoolId, uint256 data);
  event SetDebtFloor(address indexed caller, bytes32 collateralPoolId, uint256 data);

  function setTotalDebtCeiling(uint256 _data) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "BookKeeper/not-live");
    totalDebtCeiling = _data;
    emit SetTotalDebtCeiling(msg.sender, _data);
  }

  function setPriceWithSafetyMargin(bytes32 _collateralPoolId, uint256 _data) external override {
    require(hasRole(PRICE_ORACLE_ROLE, msg.sender), "!priceOracleRole");
    require(live == 1, "BookKeeper/not-live");
    collateralPools[_collateralPoolId].priceWithSafetyMargin = _data;
    emit SetPriceWithSafetyMargin(msg.sender, _collateralPoolId, _data);
  }

  function setDebtCeiling(bytes32 _collateralPoolId, uint256 _data) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "BookKeeper/not-live");
    collateralPools[_collateralPoolId].debtCeiling = _data;
    emit SetDebtCeiling(msg.sender, _collateralPoolId, _data);
  }

  function setDebtFloor(bytes32 _collateralPoolId, uint256 _data) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "BookKeeper/not-live");
    collateralPools[_collateralPoolId].debtFloor = _data;
    emit SetDebtFloor(msg.sender, _collateralPoolId, _data);
  }

  function cage() external override whenNotPaused {
    require(
      hasRole(OWNER_ROLE, msg.sender) || hasRole(SHOW_STOPPER_ROLE, msg.sender),
      "!ownerRole or !showStopperRole"
    );
    live = 0;
  }

  // --- Fungibility ---
  function addCollateral(
    bytes32 collateralPoolId,
    address usr,
    int256 wad
  ) external override whenNotPaused {
    require(hasRole(ADAPTER_ROLE, msg.sender), "!adapterRole");
    collateralToken[collateralPoolId][usr] = add(collateralToken[collateralPoolId][usr], wad);
  }

  function moveCollateral(
    bytes32 collateralPoolId,
    address src,
    address dst,
    uint256 wad
  ) external override whenNotPaused {
    require(wish(src, msg.sender), "BookKeeper/not-allowed");
    collateralToken[collateralPoolId][src] = sub(collateralToken[collateralPoolId][src], wad);
    collateralToken[collateralPoolId][dst] = add(collateralToken[collateralPoolId][dst], wad);
  }

  function moveStablecoin(
    address src,
    address dst,
    uint256 rad
  ) external override whenNotPaused {
    require(wish(src, msg.sender), "BookKeeper/not-allowed");
    stablecoin[src] = sub(stablecoin[src], rad);
    stablecoin[dst] = add(stablecoin[dst], rad);
  }

  function either(bool x, bool y) internal pure returns (bool z) {
    assembly {
      z := or(x, y)
    }
  }

  function both(bool x, bool y) internal pure returns (bool z) {
    assembly {
      z := and(x, y)
    }
  }

  // --- CDP Manipulation ---
  function adjustPosition(
    bytes32 collateralPoolId,
    address positionAddress,
    address collateralOwner,
    address stablecoinOwner,
    int256 collateralValue,
    int256 debtShare
  ) external override whenNotPaused {
    require(hasRole(POSITION_MANAGER_ROLE, msg.sender), "!positionManagerRole");

    // system is live
    require(live == 1, "BookKeeper/not-live");

    Position memory position = positions[collateralPoolId][positionAddress];
    CollateralPool memory collateralPool = collateralPools[collateralPoolId];
    // collateralPool has been initialised
    require(collateralPool.debtAccumulatedRate != 0, "BookKeeper/collateralPool-not-init");

    position.lockedCollateral = add(position.lockedCollateral, collateralValue);
    position.debtShare = add(position.debtShare, debtShare);
    collateralPool.totalDebtShare = add(collateralPool.totalDebtShare, debtShare);

    int256 debtValue = mul(collateralPool.debtAccumulatedRate, debtShare);
    uint256 positionDebtValue = mul(collateralPool.debtAccumulatedRate, position.debtShare);
    totalStablecoinIssued = add(totalStablecoinIssued, debtValue);

    // either debt has decreased, or debt ceilings are not exceeded
    require(
      either(
        debtShare <= 0,
        both(
          mul(collateralPool.totalDebtShare, collateralPool.debtAccumulatedRate) <= collateralPool.debtCeiling,
          totalStablecoinIssued <= totalDebtCeiling
        )
      ),
      "BookKeeper/ceiling-exceeded"
    );
    // position is either less risky than before, or it is safe :: check work factor
    require(
      either(
        both(debtShare <= 0, collateralValue >= 0),
        positionDebtValue <= mul(position.lockedCollateral, collateralPool.priceWithSafetyMargin)
      ),
      "BookKeeper/not-safe"
    );

    // position is either more safe, or the owner consents
    require(
      either(both(debtShare <= 0, collateralValue >= 0), wish(positionAddress, msg.sender)),
      "BookKeeper/not-allowed-u"
    );
    // collateral src consents
    require(either(collateralValue <= 0, wish(collateralOwner, msg.sender)), "BookKeeper/not-allowed-v");
    // debt dst consents
    require(either(debtShare >= 0, wish(stablecoinOwner, msg.sender)), "BookKeeper/not-allowed-w");

    // position has no debt, or a non-debtFloory amount
    require(either(position.debtShare == 0, positionDebtValue >= collateralPool.debtFloor), "BookKeeper/debtFloor");

    collateralToken[collateralPoolId][collateralOwner] = sub(
      collateralToken[collateralPoolId][collateralOwner],
      collateralValue
    );
    stablecoin[stablecoinOwner] = add(stablecoin[stablecoinOwner], debtValue);

    positions[collateralPoolId][positionAddress] = position;
    collateralPools[collateralPoolId] = collateralPool;
  }

  // --- CDP Fungibility ---
  function movePosition(
    bytes32 collateralPoolId,
    address src,
    address dst,
    int256 collateralValue,
    int256 debtShare
  ) external override whenNotPaused {
    require(hasRole(POSITION_MANAGER_ROLE, msg.sender), "!positionManagerRole");

    Position storage u = positions[collateralPoolId][src];
    Position storage v = positions[collateralPoolId][dst];
    CollateralPool storage i = collateralPools[collateralPoolId];

    u.lockedCollateral = sub(u.lockedCollateral, collateralValue);
    u.debtShare = sub(u.debtShare, debtShare);
    v.lockedCollateral = add(v.lockedCollateral, collateralValue);
    v.debtShare = add(v.debtShare, debtShare);

    uint256 utab = mul(u.debtShare, i.debtAccumulatedRate);
    uint256 vtab = mul(v.debtShare, i.debtAccumulatedRate);

    // both sides consent
    require(both(wish(src, msg.sender), wish(dst, msg.sender)), "BookKeeper/not-allowed");

    // both sides safe
    require(utab <= mul(u.lockedCollateral, i.priceWithSafetyMargin), "BookKeeper/not-safe-src");
    require(vtab <= mul(v.lockedCollateral, i.priceWithSafetyMargin), "BookKeeper/not-safe-dst");

    // both sides non-debtFloory
    require(either(utab >= i.debtFloor, u.debtShare == 0), "BookKeeper/debtFloor-src");
    require(either(vtab >= i.debtFloor, v.debtShare == 0), "BookKeeper/debtFloor-dst");
  }

  // --- CDP Confiscation ---
  function confiscatePosition(
    bytes32 collateralPoolId,
    address positionAddress,
    address collateralCreditor,
    address stablecoinDebtor,
    int256 collateralValue,
    int256 debtShare
  ) external override whenNotPaused {
    require(hasRole(LIQUIDATION_ENGINE_ROLE, msg.sender), "!liquidationEngineRole");

    Position storage position = positions[collateralPoolId][positionAddress];
    CollateralPool storage collateralPool = collateralPools[collateralPoolId];

    position.lockedCollateral = add(position.lockedCollateral, collateralValue);
    position.debtShare = add(position.debtShare, debtShare);
    collateralPool.totalDebtShare = add(collateralPool.totalDebtShare, debtShare);

    int256 debtValue = mul(collateralPool.debtAccumulatedRate, debtShare);

    collateralToken[collateralPoolId][collateralCreditor] = sub(
      collateralToken[collateralPoolId][collateralCreditor],
      collateralValue
    );
    systemBadDebt[stablecoinDebtor] = sub(systemBadDebt[stablecoinDebtor], debtValue);
    totalUnbackedStablecoin = sub(totalUnbackedStablecoin, debtValue);
  }

  // --- Settlement ---
  function settleSystemBadDebt(uint256 rad) external override whenNotPaused {
    address u = msg.sender;
    systemBadDebt[u] = sub(systemBadDebt[u], rad);
    stablecoin[u] = sub(stablecoin[u], rad);
    totalUnbackedStablecoin = sub(totalUnbackedStablecoin, rad);
    totalStablecoinIssued = sub(totalStablecoinIssued, rad);
  }

  function mintUnbackedStablecoin(
    address from,
    address to,
    uint256 rad
  ) external override whenNotPaused {
    require(hasRole(AUCTIONEER_ROLE, msg.sender), "!auctioneerRole");
    systemBadDebt[from] = add(systemBadDebt[from], rad);
    stablecoin[to] = add(stablecoin[to], rad);
    totalUnbackedStablecoin = add(totalUnbackedStablecoin, rad);
    totalStablecoinIssued = add(totalStablecoinIssued, rad);
  }

  // --- Rates ---
  function accrueStabilityFee(
    bytes32 collateralPoolId,
    address u,
    int256 debtAccumulatedRate
  ) external override whenNotPaused {
    require(hasRole(STABILITY_FEE_COLLECTOR_ROLE, msg.sender), "!stabilityFeeCollectorRole");
    require(live == 1, "BookKeeper/not-live");
    CollateralPool storage collateralPool = collateralPools[collateralPoolId];
    collateralPool.debtAccumulatedRate = add(collateralPool.debtAccumulatedRate, debtAccumulatedRate);
    int256 rad = mul(collateralPool.totalDebtShare, debtAccumulatedRate);
    stablecoin[u] = add(stablecoin[u], rad);
    totalStablecoinIssued = add(totalStablecoinIssued, rad);
  }
}
