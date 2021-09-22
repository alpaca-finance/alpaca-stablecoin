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

  mapping(bytes32 => CollateralPool) public collateralPools;
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
  function init(bytes32 collateralPool) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");

    CollateralPool storage collateralPool = collateralPools[collateralPool];
    require(collateralPool.stabilityFeeRate == 0, "StabilityFeeCollector/collateralPool-already-init");
    collateralPool.stabilityFeeRate = RAY;
    collateralPool.lastAccumulationTime = now;
  }

  event SetGlobalStabilityFeeRate(address indexed caller, uint256 data);
  event SetSystemDebtEngine(address indexed caller, address data);
  event SetStabilityFeeRate(address indexed caller, bytes32 poolId, uint256 data);

  /// @dev Set the global stability fee debtAccumulatedRate which will be apply to every collateral pool. Please see the explanation on the input format from the `setStabilityFeeRate` function.
  /// @param _globalStabilityFeeRate Global stability fee debtAccumulatedRate [ray]
  function setGlobalStabilityFeeRate(uint256 _globalStabilityFeeRate) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    globalStabilityFeeRate = _globalStabilityFeeRate;
    emit SetGlobalStabilityFeeRate(msg.sender, _globalStabilityFeeRate);
  }

  function setSystemDebtEngine(address _systemDebtEngine) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    systemDebtEngine = _systemDebtEngine;
    emit SetSystemDebtEngine(msg.sender, _systemDebtEngine);
  }

  /** @dev Set the stability fee debtAccumulatedRate of the collateral pool.
      The debtAccumulatedRate to be set here is the `r` in:

          r^N = APR

      Where:
        r = stability fee debtAccumulatedRate
        N = Accumulation frequency which is per-second in this case; the value will be 60*60*24*365 = 31536000 to signify the number of seconds within a year.
        APR = the annual percentage debtAccumulatedRate

    For example, to achieve 0.5% APR for stability fee debtAccumulatedRate:

          r^31536000 = 1.005

    Find the 31536000th root of 1.005 and we will get:

          r = 1.000000000158153903837946258002097...

    The debtAccumulatedRate is in [ray] format, so the actual value of `stabilityFeeRate` will be:

          stabilityFeeRate = 1000000000158153903837946258

    The above `stabilityFeeRate` will be the value we will use in this contract.
  */
  /// @param _collateralPool Collateral pool id
  /// @param _stabilityFeeRate the debtAccumulatedRate [ray]
  function setStabilityFeeRate(bytes32 _collateralPool, uint256 _stabilityFeeRate) external whenNotPaused {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    collateralPools[_collateralPool].stabilityFeeRate = _stabilityFeeRate;
    emit SetStabilityFeeRate(msg.sender, _collateralPool, _stabilityFeeRate);
  }

  // --- Stability Fee Collection ---
  /** @dev Collect the stability fee of the collateral pool.
      This function could be called by anyRAY.
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

  function _collect(bytes32 collateralPool) internal returns (uint256 debtAccumulatedRate) {
    require(now >= collateralPools[collateralPool].lastAccumulationTime, "StabilityFeeCollector/invalid-now");
    (, uint256 previousDebtAccumulatedRate, , , ) = bookKeeper.collateralPools(collateralPool);

    // debtAccumulatedRate [ray]
    debtAccumulatedRate = rmul(
      rpow(
        add(globalStabilityFeeRate, collateralPools[collateralPool].stabilityFeeRate),
        now - collateralPools[collateralPool].lastAccumulationTime,
        RAY
      ),
      previousDebtAccumulatedRate
    );
    bookKeeper.accrueStabilityFee(
      collateralPool,
      systemDebtEngine,
      diff(debtAccumulatedRate, previousDebtAccumulatedRate)
    );
    collateralPools[collateralPool].lastAccumulationTime = now;
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
