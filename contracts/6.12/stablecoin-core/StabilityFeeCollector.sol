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

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
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
  OwnableUpgradeable,
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  IStabilityFeeCollector
{
  // --- Auth ---
  mapping(address => uint256) public whitelist;

  function rely(address usr) external auth {
    whitelist[usr] = 1;
  }

  function deny(address usr) external auth {
    whitelist[usr] = 0;
  }

  modifier auth {
    require(whitelist[msg.sender] == 1, "StabilityFeeCollector/not-authorized");
    _;
  }

  // --- Data ---
  struct CollateralPool {
    uint256 stabilityFeeRate; // Collateral-specific, per-second stability fee rate or mint interest rate [ray]
    uint256 lastAccumulationTime; // Time of last call to `collect` [unix epoch time]
  }

  mapping(bytes32 => CollateralPool) public collateralPools;
  IBookKeeper public bookKeeper;
  address public systemDebtEngine;
  uint256 public globalStabilityFeeRate; // Global, per-second stability fee rate [ray]

  // --- Init ---
  function initialize(address _bookKeeper) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    whitelist[msg.sender] = 1;
    bookKeeper = IBookKeeper(_bookKeeper);
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

  uint256 constant ONE = 10**27;

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
    z = z / ONE;
  }

  // --- Administration ---
  function init(bytes32 collateralPool) external auth {
    CollateralPool storage i = collateralPools[collateralPool];
    require(i.stabilityFeeRate == 0, "StabilityFeeCollector/collateralPool-already-init");
    i.stabilityFeeRate = ONE;
    i.lastAccumulationTime = now;
  }

  /** @dev Set the stability fee rate of the collateral pool.
      The rate to be set here is the `r` in:

          r^N = APR

      Where:
        r = stability fee rate
        N = Accumulation frequency which is per-second in this case; the value will be 60*60*24*365 = 31536000 to signify the number of seconds within a year.
        APR = the annual percentage rate

    For example, to achieve 0.5% APR for stability fee rate:

          r^31536000 = 1.005

    Find the 31536000th root of 1.005 and we will get:

          r = 1.000000000158153903837946258002097...
    
    The rate is in [ray] format, so the actual value of `stabilityFeeRate` will be:

          stabilityFeeRate = 1000000000158153903837946258 

    The above `stabilityFeeRate` will be the value we will use in this contract.
  */
  /// @param collateralPool Collateral pool id
  /// @param what stabilityFeeRate
  /// @param data the rate [ray]
  function file(
    bytes32 collateralPool,
    bytes32 what,
    uint256 data
  ) external auth {
    _collect(collateralPool);
    if (what == "stabilityFeeRate") collateralPools[collateralPool].stabilityFeeRate = data;
    else revert("StabilityFeeCollector/file-unrecognized-param");
  }

  /// @dev Set the global stability fee rate which will be apply to every collateral pool. Please see the explanation on the input format from the above function.
  /// @param what globalStabilityFeeRate
  /// @param data Global stability fee rate [ray]
  function file(bytes32 what, uint256 data) external auth {
    if (what == "globalStabilityFeeRate") globalStabilityFeeRate = data;
    else revert("StabilityFeeCollector/file-unrecognized-param");
  }

  function file(bytes32 what, address data) external auth {
    if (what == "systemDebtEngine") systemDebtEngine = data;
    else revert("StabilityFeeCollector/file-unrecognized-param");
  }

  // --- Stability Fee Collection ---
  /** @dev Collect the stability fee of the collateral pool.
      This function could be called by anyone. 
      It will update the `debtAccumulatedRate` of the specified collateral pool according to 
      the global and per-pool stability fee rates with respect to the last block that `collect` was called.
  */
  /// @param collateralPool Collateral pool id
  function collect(bytes32 collateralPool) external override nonReentrant returns (uint256 rate) {
    _collect(collateralPool);
  }

  function _collect(bytes32 collateralPool) internal returns (uint256 rate) {
    require(now >= collateralPools[collateralPool].lastAccumulationTime, "StabilityFeeCollector/invalid-now");
    (, uint256 prev, , , ) = bookKeeper.collateralPools(collateralPool);
    rate = rmul(
      rpow(
        add(globalStabilityFeeRate, collateralPools[collateralPool].stabilityFeeRate),
        now - collateralPools[collateralPool].lastAccumulationTime,
        ONE
      ),
      prev
    );
    bookKeeper.accrueStabilityFee(collateralPool, systemDebtEngine, diff(rate, prev));
    collateralPools[collateralPool].lastAccumulationTime = now;
  }
}
