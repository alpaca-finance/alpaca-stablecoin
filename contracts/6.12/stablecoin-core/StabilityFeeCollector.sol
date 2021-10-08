// SPDX-License-Identifier: AGPL-3.0-or-later

/// jug.sol -- Dai Lending Rate

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
import "../interfaces/IStabilityFeeCollector.sol";

/// @title StabilityFeeCollector
/// @author Alpaca Fin Corporation
/** @notice A contract which acts as a collector for the stability fee.
    The stability fee is a fee that is collected from the minter of Alpaca Stablecoin in a per-seconds basis.
    The stability fee will be accumulated in the system as a surplus to settle any bad debt.
*/

contract StabilityFeeCollector is
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  IStabilityFeeCollector
{
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;
  bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");

  // --- Data ---
  struct CollateralPool {
    uint256 stabilityFeeRate; // Collateral-specific, per-second stability fee debtAccumulatedRate or mint interest debtAccumulatedRate [ray]
    uint256 lastAccumulationTime; // Time of last call to `collect` [unix epoch time]
  }

  IBookKeeper public bookKeeper;
  address public systemDebtEngine;
  uint256 public globalStabilityFeeRate; // Global, per-second stability fee debtAccumulatedRate [ray]

  // --- Init ---
  function initialize(address _bookKeeper) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    bookKeeper = IBookKeeper(_bookKeeper);

    // Grant the contract deployer the default admin role: it will be able
    // to grant and revoke any roles
    _setupRole(OWNER_ROLE, msg.sender);
  }

  // --- Math ---
  function rpow(
    uint256 x,
    uint256 n,
    uint256 b
  ) internal pure returns (uint256 z) {
    assembly {
      switch x
      case 0 {
        switch n
        case 0 {
          z := b
        }
        default {
          z := 0
        }
      }
      default {
        switch mod(n, 2)
        case 0 {
          z := b
        }
        default {
          z := x
        }
        let half := div(b, 2) // for rounding.
        for {
          n := div(n, 2)
        } n {
          n := div(n, 2)
        } {
          let xx := mul(x, x)
          if iszero(eq(div(xx, x), x)) {
            revert(0, 0)
          }
          let xxRound := add(xx, half)
          if lt(xxRound, xx) {
            revert(0, 0)
          }
          x := div(xxRound, b)
          if mod(n, 2) {
            let zx := mul(z, x)
            if and(iszero(iszero(x)), iszero(eq(div(zx, x), z))) {
              revert(0, 0)
            }
            let zxRound := add(zx, half)
            if lt(zxRound, zx) {
              revert(0, 0)
            }
            z := div(zxRound, b)
          }
        }
      }
    }
  }

  uint256 constant RAY = 10**27;

  function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = x + y;
    require(z >= x);
  }

  function diff(uint256 x, uint256 y) internal pure returns (int256 z) {
    z = int256(x) - int256(y);
    require(int256(x) >= 0 && int256(y) >= 0);
  }

  function rmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = x * y;
    require(y == 0 || z / y == x);
    z = z / RAY;
  }

  // --- Administration ---
  event LogSetGlobalStabilityFeeRate(address indexed caller, uint256 data);
  event LogSetSystemDebtEngine(address indexed caller, address data);

  /// @dev Set the global stability fee debtAccumulatedRate which will be apply to every collateral pool. Please see the explanation on the input format from the `setStabilityFeeRate` function.
  /// @param _globalStabilityFeeRate Global stability fee debtAccumulatedRate [ray]
  function setGlobalStabilityFeeRate(uint256 _globalStabilityFeeRate) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    globalStabilityFeeRate = _globalStabilityFeeRate;
    emit LogSetGlobalStabilityFeeRate(msg.sender, _globalStabilityFeeRate);
  }

  function setSystemDebtEngine(address _systemDebtEngine) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    systemDebtEngine = _systemDebtEngine;
    emit LogSetSystemDebtEngine(msg.sender, _systemDebtEngine);
  }

  // --- Stability Fee Collection ---
  /** @dev Collect the stability fee of the collateral pool.
      This function could be called by anyone.
      It will update the `debtAccumulatedRate` of the specified collateral pool according to
      the global and per-pool stability fee rates with respect to the last block that `collect` was called.
  */
  /// @param collateralPool Collateral pool id
  function collect(bytes32 collateralPool)
    external
    override
    whenNotPaused
    nonReentrant
    returns (uint256 debtAccumulatedRate)
  {
    debtAccumulatedRate = _collect(collateralPool);
  }

  function _collect(bytes32 _collateralPoolId) internal returns (uint256 _debtAccumulatedRate) {
    (
      ,
      uint256 _previousDebtAccumulatedRate,
      ,
      ,
      ,
      ,
      ,
      uint256 _stabilityFeeRate,
      uint256 _lastAccumulationTime,
      ,
      ,
      ,

    ) = bookKeeper.collateralPoolConfig().collateralPools(_collateralPoolId);
    require(now >= _lastAccumulationTime, "StabilityFeeCollector/invalid-now");

    // debtAccumulatedRate [ray]
    _debtAccumulatedRate = rmul(
      rpow(add(globalStabilityFeeRate, _stabilityFeeRate), now - _lastAccumulationTime, RAY),
      _previousDebtAccumulatedRate
    );
    bookKeeper.accrueStabilityFee(
      _collateralPoolId,
      systemDebtEngine,
      diff(_debtAccumulatedRate, _previousDebtAccumulatedRate)
    );
    bookKeeper.collateralPoolConfig().updateLastAccumulationTime(_collateralPoolId);
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
