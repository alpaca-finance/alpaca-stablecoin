// SPDX-License-Identifier: AGPL-3.0-or-later

// Copyright (C) 2020 Maker Ecosystem Growth Holdings, INC.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
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

import "../../interfaces/ICalculator.sol";

// While an equivalent function can be obtained by setting step = 1 in StairstepExponentialDecrease,
// this continous (i.e. per-second) exponential decrease has be implemented as it is more gas-efficient
// than using the stairstep version with step = 1 (primarily due to 1 fewer SLOAD per price calculation).
contract ExponentialDecrease is ICalculator {
  // --- Auth ---
  mapping(address => uint256) public wards;

  function rely(address usr) external auth {
    wards[usr] = 1;
    emit Rely(usr);
  }

  function deny(address usr) external auth {
    wards[usr] = 0;
    emit Deny(usr);
  }

  modifier auth() {
    require(wards[msg.sender] == 1, "ExponentialDecrease/not-authorized");
    _;
  }

  // --- Data ---
  uint256 public cut; // Per-second multiplicative factor [ray]

  // --- Events ---
  event Rely(address indexed usr);
  event Deny(address indexed usr);

  event File(bytes32 indexed what, uint256 data);

  // --- Init ---
  // @notice: `cut` value must be correctly set for
  //     this contract to return a valid price
  constructor() public {
    wards[msg.sender] = 1;
    emit Rely(msg.sender);
  }

  // --- Administration ---
  function file(bytes32 what, uint256 data) external auth {
    if (what == "cut") require((cut = data) <= RAY, "ExponentialDecrease/cut-gt-RAY");
    else revert("ExponentialDecrease/file-unrecognized-param");
    emit File(what, data);
  }

  // --- Math ---
  uint256 constant RAY = 10**27;

  function rmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = x * y;
    require(y == 0 || z / y == x);
    z = z / RAY;
  }

  // optimized version from dss PR #78
  function rpow(
    uint256 x,
    uint256 n,
    uint256 b
  ) internal pure returns (uint256 z) {
    assembly {
      switch n
      case 0 {
        z := b
      }
      default {
        switch x
        case 0 {
          z := 0
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
            if shr(128, x) {
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
  }

  // top: initial price
  // dur: seconds since the auction has started
  // cut: cut encodes the percentage to decrease per second.
  //   For efficiency, the values is set as (1 - (% value / 100)) * RAY
  //   So, for a 1% decrease per second, cut would be (1 - 0.01) * RAY
  //
  // returns: top * (cut ^ dur)
  //
  function price(uint256 top, uint256 dur) external view override returns (uint256) {
    return rmul(top, rpow(cut, dur, RAY));
  }
}
