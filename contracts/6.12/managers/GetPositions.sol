// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.6.12;

import "./PositionManager.sol";

contract GetPositions {
  function getPostionsAsc(address manager, address user)
    external
    view
    returns (
      uint256[] memory ids,
      address[] memory positions,
      bytes32[] memory collateralPools
    )
  {
    uint256 count = PositionManager(manager).ownerPositionCount(user);
    ids = new uint256[](count);
    positions = new address[](count);
    collateralPools = new bytes32[](count);
    uint256 i = 0;
    uint256 id = PositionManager(manager).ownerFirstPositionId(user);

    while (id > 0) {
      ids[i] = id;
      positions[i] = PositionManager(manager).positions(id);
      collateralPools[i] = PositionManager(manager).collateralPools(id);
      (, id) = PositionManager(manager).list(id);
      i++;
    }
  }

  function getPositionsDesc(address manager, address user)
    external
    view
    returns (
      uint256[] memory ids,
      address[] memory positions,
      bytes32[] memory collateralPools
    )
  {
    uint256 count = PositionManager(manager).ownerPositionCount(user);
    ids = new uint256[](count);
    positions = new address[](count);
    collateralPools = new bytes32[](count);
    uint256 i = 0;
    uint256 id = PositionManager(manager).ownerLastPositionId(user);

    while (id > 0) {
      ids[i] = id;
      positions[i] = PositionManager(manager).positions(id);
      collateralPools[i] = PositionManager(manager).collateralPools(id);
      (id, ) = PositionManager(manager).list(id);
      i++;
    }
  }
}
