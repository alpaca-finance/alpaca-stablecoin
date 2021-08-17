// SPDX-License-Identifier: AGPL-3.0-or-later

/// GetCdps.sol

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

pragma solidity >=0.5.12;

import "./CDPManager.sol";

contract GetCDPs {
  function getCdpsAsc(address manager, address guy)
    external
    view
    returns (
      uint256[] memory ids,
      address[] memory positions,
      bytes32[] memory collateralPools
    )
  {
    uint256 count = CDPManager(manager).count(guy);
    ids = new uint256[](count);
    positions = new address[](count);
    collateralPools = new bytes32[](count);
    uint256 i = 0;
    uint256 id = CDPManager(manager).first(guy);

    while (id > 0) {
      ids[i] = id;
      positions[i] = CDPManager(manager).positions(id);
      collateralPools[i] = CDPManager(manager).collateralPools(id);
      (, id) = CDPManager(manager).list(id);
      i++;
    }
  }

  function getCdpsDesc(address manager, address guy)
    external
    view
    returns (
      uint256[] memory ids,
      address[] memory positions,
      bytes32[] memory collateralPools
    )
  {
    uint256 count = CDPManager(manager).count(guy);
    ids = new uint256[](count);
    positions = new address[](count);
    collateralPools = new bytes32[](count);
    uint256 i = 0;
    uint256 id = CDPManager(manager).last(guy);

    while (id > 0) {
      ids[i] = id;
      positions[i] = CDPManager(manager).positions(id);
      collateralPools[i] = CDPManager(manager).collateralPools(id);
      (id, ) = CDPManager(manager).list(id);
      i++;
    }
  }
}
