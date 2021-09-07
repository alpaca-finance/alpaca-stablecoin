// SPDX-License-Identifier: AGPL-3.0-or-later

/// IBookKeeper.sol

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

interface IBookKeeper {
  function collateralToken(bytes32, address) external view returns (uint256);

  function addCollateral(
    bytes32,
    address,
    int256
  ) external;

  function movePosition(
    bytes32,
    address,
    address,
    int256,
    int256
  ) external;

  function can(address, address) external view returns (uint256);

  function adjustPosition(
    bytes32,
    address,
    address,
    address,
    int256,
    int256
  ) external;

  function setTotalDebtCeiling(uint256) external;

  function setPriceWithSafetyMargin(bytes32, uint256) external;

  function setDebtCeiling(bytes32, uint256) external;

  function setDebtFloor(bytes32, uint256) external;

  function stablecoin(address) external view returns (uint256);

  function positions(bytes32 collateralPoolId, address urn)
    external
    view
    returns (
      uint256 lockedCollateral, // [wad]
      uint256 debtShare // [wad]
    );

  function totalStablecoinIssued() external returns (uint256);

  function moveStablecoin(
    address src,
    address dst,
    uint256 rad
  ) external;

  function moveCollateral(
    bytes32 collateralPoolId,
    address src,
    address dst,
    uint256 rad
  ) external;

  function confiscatePosition(
    bytes32 i,
    address u,
    address v,
    address w,
    int256 dink,
    int256 dart
  ) external;

  function mintUnbackedStablecoin(
    address u,
    address v,
    uint256 rad
  ) external;

  function cage() external;

  function collateralPools(bytes32)
    external
    view
    returns (
      uint256,
      uint256,
      uint256,
      uint256,
      uint256
    );

  function accrueStabilityFee(
    bytes32,
    address,
    int256
  ) external;

  function systemBadDebt(address) external view returns (uint256);

  function settleSystemBadDebt(uint256) external;

  function hope(address) external;

  function nope(address) external;
}
