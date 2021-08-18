// SPDX-License-Identifier: AGPL-3.0-or-later

/// PositionHandler.sol

// Copyright (C) 2018-2020 Maker Ecosystem Growth Holdings, INC.

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

interface GovernmentLike {
  function positions(bytes32, address) external view returns (uint256, uint256);

  function hope(address) external;

  function moveCollateral(
    bytes32,
    address,
    address,
    uint256
  ) external;

  function moveStablecoin(
    address,
    address,
    uint256
  ) external;

  function adjustPosition(
    bytes32,
    address,
    address,
    address,
    int256,
    int256
  ) external;

  function movePosition(
    bytes32,
    address,
    address,
    int256,
    int256
  ) external;
}

contract PositionHandler {
  address public immutable owner;

  constructor(address government) public {
    owner = msg.sender;
    GovernmentLike(government).hope(msg.sender);
  }
}
