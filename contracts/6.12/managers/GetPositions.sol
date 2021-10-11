// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "./PositionManager.sol";
import "../interfaces/IBookKeeper.sol";

contract GetPositions is Initializable {
  using SafeMathUpgradeable for uint256;

  // --- Math ---
  uint256 constant WAD = 10**18;
  uint256 constant RAY = 10**27;
  uint256 constant RAD = 10**45;

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

  function getPositionWithSafetyBuffer(
    address _manager,
    uint256 _startIndex,
    uint256 _offset
  )
    external
    view
    returns (
      address[] memory positions,
      uint256[] memory debtShares,
      uint256[] memory safetyBuffers
    )
  {
    if (_startIndex.add(_offset) > PositionManager(_manager).lastPositionId())
      _offset = PositionManager(_manager).lastPositionId().sub(_startIndex).add(1);

    IBookKeeper bookKeeper = IBookKeeper(PositionManager(_manager).bookKeeper());
    positions = new address[](_offset);
    debtShares = new uint256[](_offset);
    safetyBuffers = new uint256[](_offset);
    uint256 _resultIndex = 0;
    for (uint256 _positionIndex = _startIndex; _positionIndex < _startIndex.add(_offset); _positionIndex++) {
      if (PositionManager(_manager).positions(_positionIndex) == address(0)) break;
      positions[_resultIndex] = PositionManager(_manager).positions(_positionIndex);

      (uint256 _lockedCollateral, uint256 _debtShare) = bookKeeper.positions(
        PositionManager(_manager).collateralPools(_positionIndex),
        positions[_resultIndex]
      );
      ICollateralPoolConfig.CollateralPool memory collateralPool = ICollateralPoolConfig(
        IBookKeeper(bookKeeper).collateralPoolConfig()
      ).collateralPools(PositionManager(_manager).collateralPools(_positionIndex));
      uint256 _debtAccumulatedRate = collateralPool.debtAccumulatedRate;
      uint256 _priceWithSafetyMargin = collateralPool.priceWithSafetyMargin;

      uint256 safetyBuffer = calculateSafetyBuffer(
        _debtShare,
        _debtAccumulatedRate,
        _lockedCollateral,
        _priceWithSafetyMargin
      );
      safetyBuffers[_resultIndex] = safetyBuffer;
      debtShares[_resultIndex] = _debtShare;
      _resultIndex++;
    }
  }

  function calculateSafetyBuffer(
    uint256 _debtShare, // [wad]
    uint256 _debtAccumulatedRate, // [ray]
    uint256 _lockedCollateral, // [wad]
    uint256 _priceWithSafetyMargin // [ray]
  )
    internal
    view
    returns (
      uint256 _safetyBuffer // [rad]
    )
  {
    uint256 collateralValue = _lockedCollateral.mul(_priceWithSafetyMargin);
    uint256 debtValue = _debtShare.mul(_debtAccumulatedRate);
    _safetyBuffer = collateralValue >= debtValue ? collateralValue.sub(debtValue) : 0;
  }
}
