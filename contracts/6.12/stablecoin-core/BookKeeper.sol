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

/// @title BookKeeper
/// @author Alpaca Fin Corporation
/** @notice A contract which acts as a book keeper of the Alpaca Stablecoin protocol. 
    It has the ability to move collateral token and stablecoin with in the accounting state variable. 
*/

contract BookKeeper is IBookKeeper, OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable {
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

  modifier auth {
    require(whitelist[msg.sender] == 1, "BookKeeper/not-authorized");
    _;
  }

  /// @dev This is the mapping which stores the consent or allowance to adjust positions by the position addresses. 
  /// @dev `address` The position address
  /// @dev `address` The allowance delegate address
  /// @dev `uint256` true (1) means allowed or false (0) means not allowed 
  mapping(address => mapping(address => uint256)) public override can;

  /// @dev Give an allowance to the `usr` address to adjust the position address who is the caller.
  /// @dev `usr` The address to be allowed to adjust position
  function hope(address usr) external override {
    can[msg.sender][usr] = 1;
  }

  /// @dev Revoke an allowance from the `usr` address to adjust the position address who is the caller.
  /// @dev `usr` The address to be revoked from adjusting position
  function nope(address usr) external override {
    can[msg.sender][usr] = 0;
  }

  /// @dev Check if the `usr` address is allowed to adjust the position address (`bit`).
  /// @param bit The position address
  /// @param usr The address to be checked for permission
  function wish(address bit, address usr) internal view returns (bool) {
    return either(bit == usr, can[bit][usr] == 1);
  }

  // --- Data ---
  struct CollateralPool {
    uint256 totalDebtShare; // Total debt sgare of Alpaca Stablecoin of this collateral pool              [wad]
    uint256 debtAccumulatedRate; // Accumulated rates (equivalent to ibToken Price)                       [ray]
    uint256 priceWithSafetyMargin; // Price with safety margin (taken into account the Collateral Ratio)  [ray]
    uint256 debtCeiling; // Debt ceiling of this collateral pool                                          [rad]
    uint256 debtFloor; // Position debt floor of this collateral pool                                     [rad]
  }
  struct Position {
    uint256 lockedCollateral; // Locked collateral inside this position (used for minting)                  [wad]
    uint256 debtShare; // The debt share of this position or the share amount of minted Alpaca Stablecoin   [wad]
  }

  mapping(bytes32 => CollateralPool) public override collateralPools; // mapping of all collateral pool by its unique name in string
  mapping(bytes32 => mapping(address => Position)) public override positions; // mapping of all positions by collateral pool id and position address
  mapping(bytes32 => mapping(address => uint256)) public override collateralToken; // the accounting of collateral token which is deposited into the protocol [wad]
  mapping(address => uint256) public override stablecoin; // the accounting of the stablecoin that is deposited or has not been withdrawn from the protocol [rad]
  mapping(address => uint256) public override systemBadDebt; // the bad debt of the system from late liquidation [rad]

  uint256 public override totalStablecoinIssued; // Total stable coin issued or total stalbecoin in circulation   [rad]
  uint256 public totalUnbackedStablecoin; // Total unbacked stable coin  [rad]
  uint256 public totalDebtCeiling; // Total debt ceiling  [rad]
  uint256 public live; // Active Flag

  // --- Init ---
  function initialize() external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    whitelist[msg.sender] = 1;
    live = 1;
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
  function init(bytes32 collateralPoolId) external auth {
    require(collateralPools[collateralPoolId].debtAccumulatedRate == 0, "BookKeeper/collateral-pool-already-init");
    collateralPools[collateralPoolId].debtAccumulatedRate = 10**27;
  }

  function file(bytes32 what, uint256 data) external override auth {
    require(live == 1, "BookKeeper/not-live");
    if (what == "totalDebtCeiling") totalDebtCeiling = data;
    else revert("BookKeeper/file-unrecognized-param");
  }

  function file(
    bytes32 collateralPoolId,
    bytes32 what,
    uint256 data
  ) external override auth {
    require(live == 1, "BookKeeper/not-live");
    if (what == "priceWithSafetyMargin") collateralPools[collateralPoolId].priceWithSafetyMargin = data;
    else if (what == "debtCeiling") collateralPools[collateralPoolId].debtCeiling = data;
    else if (what == "debtFloor") collateralPools[collateralPoolId].debtFloor = data;
    else revert("BookKeeper/file-unrecognized-param");
  }

  function cage() external override auth {
    live = 0;
  }

  // --- Fungibility ---
  /// @dev Add or remove collateral token balance to an address within the accounting of the protocol
  /// @param collateralPoolId The collateral pool id
  /// @param usr The target address
  /// @param wad The collateral amount in [wad]
  function addCollateral(
    bytes32 collateralPoolId,
    address usr,
    int256 wad
  ) external override auth {
    collateralToken[collateralPoolId][usr] = add(collateralToken[collateralPoolId][usr], wad);
  }

  /// @dev Move a balance of collateral token from a source address to a destination address within the accounting of the protocol
  /// @param collateralPoolId the collateral pool id
  /// @param src The source address
  /// @param dst The destination address
  /// @param wad The collateral amount in [wad]
  function moveCollateral(
    bytes32 collateralPoolId,
    address src,
    address dst,
    uint256 wad
  ) external override {
    require(wish(src, msg.sender), "BookKeeper/not-allowed");
    collateralToken[collateralPoolId][src] = sub(collateralToken[collateralPoolId][src], wad);
    collateralToken[collateralPoolId][dst] = add(collateralToken[collateralPoolId][dst], wad);
  }

  /// @dev Move a balance of stablecoin from a source address to a destination address within the accounting of the protocol
  /// @param src The source address
  /// @param dst The destination address
  /// @param rad The stablecoin amount in [rad]
  function moveStablecoin(
    address src,
    address dst,
    uint256 rad
  ) external override {
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
  /// @dev Adjust a position on the target position address to perform locking/unlocking of collateral and minting/repaying of stablecoin
  /// @param collateralPoolId Collateral pool id
  /// @param positionAddress Address of the position
  /// @param collateralOwner The payer/receiver of the collateral token, the collateral token must already be deposited into the protocol in case of locking the collateral
  /// @param stablecoinOwner The payer/receiver of the stablecoin, the stablecoin must already be deposited into the protocol in case of repaying debt
  /// @param collateralValue The value of the collateral to lock/unlock
  /// @param debtShare The debt share of stalbecoin to mint/repay. Please pay attention that this is a debt share not debt value.
  function adjustPosition(
    bytes32 collateralPoolId,
    address positionAddress,
    address collateralOwner,
    address stablecoinOwner,
    int256 collateralValue,
    int256 debtShare
  ) external override {
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
  /// @dev Move the collateral or stablecoin debt inside a position to another position
  /// @param collateralPoolId Collateral pool id
  /// @param src Source address of the position
  /// @param dst Destination address of the position
  /// @param collateralValue The value of the locked collateral to be moved
  /// @param debtShare The debt share of stalbecoin to be moved
  function movePosition(
    bytes32 collateralPoolId,
    address src,
    address dst,
    int256 collateralValue,
    int256 debtShare
  ) external override {
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
  /** @dev Confiscate position from the owner for the position to be liquidated.
      The position will be confiscated of collateral in which these collateral will be sold through a liquidation process to repay the stablecoin debt.
      The confiscated collateral will be seized by the Auctioneer contracts and will be moved to the corresponding liquidator addresses upon later.
      The stablecoin debt will be mark up on the SystemDebtEngine contract first. This would signify that the system currently has a bad debt of this amount. 
      But it will be cleared later on from a successful liquidation. If this debt is not fully liquidated, the remaining debt will stay inside SystemDebtEngine as bad debt.
  */
  /// @param collateralPoolId Collateral pool id
  /// @param positionAddress The position address
  /// @param collateralCreditor The address which will temporarily own the collateral of the liquidated position; this will always be the Auctioneer
  /// @param stablecoinDebtor The address which will be the one to be in debt for the amount of stablecoin debt of the liquidated position, this will always be the SystemDebtEngine
  /// @param collateralValue The amount of collateral to be confiscated
  /// @param debtShare The debt share to be confiscated
  function confiscatePosition(
    bytes32 collateralPoolId,
    address positionAddress,
    address collateralCreditor,
    address stablecoinDebtor,
    int256 collateralValue,
    int256 debtShare
  ) external override auth {
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
  /** @dev Settle the system bad debt of the caller.
      This function will always be called by the SystemDebtEngine which will be the contract that always incur the system debt.
      By executing this function, the SystemDebtEngine must have enough stablecoin which will come from the Surplus of the protocol.
      A successful `settleSystemBadDebt` would remove the bad debt from the system.
  */
  /// @param rad the amount of stablecoin to be used to settle bad debt [rad]
  function settleSystemBadDebt(uint256 rad) external override {
    address u = msg.sender;
    systemBadDebt[u] = sub(systemBadDebt[u], rad);
    stablecoin[u] = sub(stablecoin[u], rad);
    totalUnbackedStablecoin = sub(totalUnbackedStablecoin, rad);
    totalStablecoinIssued = sub(totalStablecoinIssued, rad);
  }

  /// @dev Mint unbacked stablecoin without any collateral to be used for incentives and flash mint.
  /// @param from The address which will be the one who incur bad debt (will always be SystemDebtEngine here)
  /// @param to The address which will receive the minted stablecoin
  /// @param rad The amount of stablecoin to be minted
  function mintUnbackedStablecoin(
    address from,
    address to,
    uint256 rad
  ) external override auth {
    systemBadDebt[from] = add(systemBadDebt[from], rad);
    stablecoin[to] = add(stablecoin[to], rad);
    totalUnbackedStablecoin = add(totalUnbackedStablecoin, rad);
    totalStablecoinIssued = add(totalStablecoinIssued, rad);
  }

  // --- Rates ---
  /** @dev Accrue stability fee or the mint interest rate.
      This function will always be called only by the StabilityFeeCollector contract.
      `debtAccumulatedRate` of a collateral pool is the exchange rate of the stablecoin minted from that pool (think of it like ibToken price from Lending Vault).
      The higher the `debtAccumulatedRate` means the minter of the stablecoin will beed to pay back the debt with higher amount.
      The point of Stability Fee is to collect a surplus amount from minters and this is technically done by incrementing the `debtAccumulatedRate` overtime.
  */
  /// @param collateralPoolId Collateral pool id
  /// @param u The address which will receive the surplus from Stability Fee. This will always be SystemDebtEngine who will use the surplus to settle bad debt.
  /// @param debtAccumulatedRate The difference value of `debtAccumulatedRate` which will be added to the current value of `debtAccumulatedRate`.
  function accrueStabilityFee(
    bytes32 collateralPoolId,
    address u,
    int256 debtAccumulatedRate
  ) external override auth {
    require(live == 1, "BookKeeper/not-live");
    CollateralPool storage collateralPool = collateralPools[collateralPoolId];
    collateralPool.debtAccumulatedRate = add(collateralPool.debtAccumulatedRate, debtAccumulatedRate);
    int256 rad = mul(collateralPool.totalDebtShare, debtAccumulatedRate);
    stablecoin[u] = add(stablecoin[u], rad);
    totalStablecoinIssued = add(totalStablecoinIssued, rad);
  }
}
