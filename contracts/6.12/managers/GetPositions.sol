// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "./PositionManager.sol";
import "../interfaces/IBookKeeper.sol";

contract GetPositions is Initializable {
  using SafeMathUpgradeable for uint256;

  // --- Init ---
  function initialize() external initializer {}

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

  function getPositionsAtRisk(
    address _manager,
    uint256 _safetyBufferThreshold,
    uint256 _startIndex,
    uint256 _offset
  )
    external
    view
    returns (
      uint256[] memory ids,
      address[] memory positions,
      bytes32[] memory collateralPools,
      uint256[] memory lockedCollaterals,
      uint256[] memory debtShares,
      uint256[] memory safetyBuffer
    )
  {
    IBookKeeper bookKeeper = IBookKeeper(PositionManager(_manager).bookKeeper());
    uint256 _resultIndex = 0;
    for (uint256 _positionIndex = _startIndex; _positionIndex < _startIndex.add(_offset); _positionIndex++) {
      ids[_resultIndex] = _positionIndex;
      positions[_resultIndex] = PositionManager(_manager).positions(_positionIndex);
      collateralPools[_resultIndex] = PositionManager(_manager).collateralPools(_positionIndex);

      (lockedCollaterals[_resultIndex], debtShares[_resultIndex]) = bookKeeper.positions(
        collateralPools[_resultIndex],
        positions[_resultIndex]
      );

      (, uint256 _debtAccumulatedRate, uint256 _priceWithSafetyMargin, , ) = bookKeeper.collateralPools(
        collateralPools[_resultIndex]
      );

      safetyBuffer[_resultIndex] = debtShares[_resultIndex]
        .mul(_debtAccumulatedRate)
        .div(lockedCollaterals[_resultIndex])
        .div(_priceWithSafetyMargin);
      if (safetyBuffer[_resultIndex] <= _safetyBufferThreshold) {
        _resultIndex++;
      }
    }
  }
}
