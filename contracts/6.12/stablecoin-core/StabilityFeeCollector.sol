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

// FIXME: This contract was altered compared to the production version.
// It doesn't use LibNote anymore.
// New deployments of this contract will need to include custom events (TO DO).

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
    uint256 stabilityFeeRate; // Collateral-specific, per-second stability fee contribution [ray]
    uint256 lastAccumulationTime; // Time of last drip [unix epoch time]
  }

  mapping(bytes32 => CollateralPool) public collateralPools;
  IBookKeeper public bookKeeper; // CDP Engine
  address public systemDebtEngine; // Debt Engine
  uint256 public globalStabilityFeeRate; // Global, per-second stability fee contribution [ray]

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

  function file(
    bytes32 collateralPool,
    bytes32 what,
    uint256 data
  ) external auth {
    _collect(collateralPool);
    if (what == "stabilityFeeRate") collateralPools[collateralPool].stabilityFeeRate = data;
    else revert("StabilityFeeCollector/file-unrecognized-param");
  }

  function file(bytes32 what, uint256 data) external auth {
    if (what == "globalStabilityFeeRate") globalStabilityFeeRate = data;
    else revert("StabilityFeeCollector/file-unrecognized-param");
  }

  function file(bytes32 what, address data) external auth {
    if (what == "systemDebtEngine") systemDebtEngine = data;
    else revert("StabilityFeeCollector/file-unrecognized-param");
  }

  // --- Stability Fee Collection ---
  function collect(bytes32 collateralPool) external override nonReentrant returns (uint256 rate) {
    rate = _collect(collateralPool);
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
