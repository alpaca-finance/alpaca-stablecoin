// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "./PositionHandler.sol";
import "../interfaces/IManager.sol";
import "../interfaces/IBookKeeper.sol";
import "../interfaces/IGenericTokenAdapter.sol";
import "../interfaces/IShowStopper.sol";

/// @title PositionManager is a contract for manging positions
contract PositionManager is OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable, IManager {
  /// @dev Address of a BookKeeper
  address public override bookKeeper;

  address public showStopper;

  /// @dev The lastest id that has been used
  uint256 public lastPositionId;
  /// @dev Mapping of posId => positionHandler
  mapping(uint256 => address) public override positions;
  /// @dev Mapping of posId => prev & next posId; Double linked list
  mapping(uint256 => List) public list;
  /// @dev Mapping of posId => owner
  mapping(uint256 => address) public override owners;
  /// @dev Mapping of positionHandler => owner
  mapping(address => address) public override mapPositionHandlerToOwner;
  /// @dev Mapping of posId => collateralPool
  mapping(uint256 => bytes32) public override collateralPools;

  /// @dev Mapping of owner => the first posId
  mapping(address => uint256) public ownerFirstPositionId;
  /// @dev Mapping of owner => the last posId
  mapping(address => uint256) public ownerLastPositionId;
  /// @dev Mapping of owner => the number of positions he has
  mapping(address => uint256) public ownerPositionCount;

  /// @dev Mapping of owner => whitelisted address that can manage owner's position
  mapping(address => mapping(uint256 => mapping(address => uint256))) public override ownerWhitelist;
  /// @dev Mapping of owner => whitelisted address that can migrate position
  mapping(address => mapping(address => uint256)) public migrationWhitelist;

  struct List {
    uint256 prev;
    uint256 next;
  }

  event NewPosition(address indexed usr, address indexed own, uint256 indexed posId);
  event AllowManagePosition(address indexed caller, uint256 indexed posId, address owner, address user, uint256 ok);
  event AllowMigratePosition(address indexed caller, address user, uint256 ok);
  event ExportPosition(
    uint256 indexed posId,
    address source,
    address destination,
    uint256 lockedCollateral,
    uint256 debtShare
  );
  event ImportPosition(
    uint256 indexed posId,
    address source,
    address destination,
    uint256 lockedCollateral,
    uint256 debtShare
  );
  event MovePosition(uint256 sourceId, uint256 destinationId, uint256 lockedCollateral, uint256 debtShare);

  /// @dev Require that the caller must be position's owner or owner whitelist
  modifier onlyOwnerAllowed(uint256 posId) {
    require(msg.sender == owners[posId] || ownerWhitelist[owners[posId]][posId][msg.sender] == 1, "owner not allowed");
    _;
  }

  /// @dev Require that the caller must be allowed to migrate position to the migrant address
  modifier onlyMigrationAllowed(address migrantAddress) {
    require(
      msg.sender == migrantAddress || migrationWhitelist[migrantAddress][msg.sender] == 1,
      "migration not allowed"
    );
    _;
  }

  /// @dev Initializer for intializing PositionManager
  /// @param _bookKeeper The address of the Book Keeper
  function initialize(address _bookKeeper, address _showStopper) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    bookKeeper = _bookKeeper;
    showStopper = _showStopper;
  }

  function _safeAdd(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x + y) >= x, "add overflow");
  }

  function _safeSub(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x - y) <= x, "sub overflow");
  }

  function _safeToInt(uint256 x) internal pure returns (int256 y) {
    y = int256(x);
    require(y >= 0, "must not negative");
  }

  /// @dev Allow/disallow a user to manage the position
  /// @param posId The position id
  /// @param user The address to be allowed for managing the position
  /// @param ok Ok flag to allow/disallow. 1 for allow and 0 for disallow.
  function allowManagePosition(
    uint256 posId,
    address user,
    uint256 ok
  ) public override onlyOwnerAllowed(posId) {
    ownerWhitelist[owners[posId]][posId][user] = ok;
    emit AllowManagePosition(msg.sender, posId, owners[posId], user, ok);
  }

  /// @dev Allow/disallow a user to importPosition/exportPosition from/to msg.sender
  /// @param user The address of user that will be allowed to do such an action to msg.sender
  /// @param ok Ok flag to allow/disallow
  function allowMigratePosition(address user, uint256 ok) public override {
    migrationWhitelist[msg.sender][user] = ok;
    emit AllowMigratePosition(msg.sender, user, ok);
  }

  /// @dev Open a new position for a given user address.
  /// @param collateralPoolId The collateral pool id that will be used for this position
  /// @param user The user address that is owned this position
  function open(bytes32 collateralPoolId, address user) public override returns (uint256) {
    require(user != address(0), "user address(0)");

    lastPositionId = _safeAdd(lastPositionId, 1);
    positions[lastPositionId] = address(new PositionHandler(bookKeeper));
    owners[lastPositionId] = user;
    mapPositionHandlerToOwner[positions[lastPositionId]] = user;
    collateralPools[lastPositionId] = collateralPoolId;

    // Add new position to double linked list and pointers
    if (ownerFirstPositionId[user] == 0) {
      ownerFirstPositionId[user] = lastPositionId;
    }
    if (ownerLastPositionId[user] != 0) {
      list[lastPositionId].prev = ownerLastPositionId[user];
      list[ownerLastPositionId[user]].next = lastPositionId;
    }
    ownerLastPositionId[user] = lastPositionId;
    ownerPositionCount[user] = _safeAdd(ownerPositionCount[user], 1);

    emit NewPosition(msg.sender, user, lastPositionId);

    return lastPositionId;
  }

  /// @dev Give the position ownership to a destination address
  /// @param posId The position id to be given away ownership
  /// @param destination The destination to be a new owner of the position
  function give(uint256 posId, address destination) public override onlyOwnerAllowed(posId) {
    require(destination != address(0), "destination address(0)");
    require(destination != owners[posId], "destination already owner");

    // Remove transferred position from double linked list of origin user and pointers
    if (list[posId].prev != 0) {
      // Set the next pointer of the prev position (if exists) to the next of the transferred one
      list[list[posId].prev].next = list[posId].next;
    }

    if (list[posId].next != 0) {
      // If wasn't the last one
      // Set the prev pointer of the next position to the prev of the transferred one
      list[list[posId].next].prev = list[posId].prev;
    } else {
      // If was the last one
      // Update last pointer of the owner
      ownerLastPositionId[owners[posId]] = list[posId].prev;
    }

    if (ownerFirstPositionId[owners[posId]] == posId) {
      // If was the first one
      // Update first pointer of the owner
      ownerFirstPositionId[owners[posId]] = list[posId].next;
    }
    ownerPositionCount[owners[posId]] = _safeSub(ownerPositionCount[owners[posId]], 1);

    // Transfer ownership
    owners[posId] = destination;
    mapPositionHandlerToOwner[positions[posId]] = destination;

    // Add transferred position to double linked list of destiny user and pointers
    list[posId].prev = ownerLastPositionId[destination];
    list[posId].next = 0;
    if (ownerLastPositionId[destination] != 0) {
      list[ownerLastPositionId[destination]].next = posId;
    }
    if (ownerFirstPositionId[destination] == 0) {
      ownerFirstPositionId[destination] = posId;
    }
    ownerLastPositionId[destination] = posId;
    ownerPositionCount[destination] = _safeAdd(ownerPositionCount[destination], 1);
  }

  /// @dev Adjust the position keeping the generated stablecoin
  /// or collateral freed in the positionHandler address.
  /// @param posId The position id to be adjusted
  /// @param collateralValue The collateralValue to be adjusted
  /// @param debtShare The debtShare to be adjusted
  /// @param adapter The adapter to be called once the position is adjusted
  /// @param data The extra data for adapter
  function adjustPosition(
    uint256 posId,
    int256 collateralValue,
    int256 debtShare,
    address adapter,
    bytes calldata data
  ) public override onlyOwnerAllowed(posId) {
    address positionAddress = positions[posId];
    IBookKeeper(bookKeeper).adjustPosition(
      collateralPools[posId],
      positionAddress,
      positionAddress,
      positionAddress,
      collateralValue,
      debtShare
    );
    IGenericTokenAdapter(adapter).onAdjustPosition(positionAddress, positionAddress, collateralValue, debtShare, data);
  }

  /// @dev Transfer wad amount of position's collateral from the positionHandler address to a destination address.
  /// @param posId The position id to move collateral from
  /// @param destination The destination to received collateral
  /// @param wad The amount in wad to be moved
  /// @param adapter The adapter to be called when collateral has been moved
  /// @param data The extra data for the adapter
  function moveCollateral(
    uint256 posId,
    address destination,
    uint256 wad,
    address adapter,
    bytes calldata data
  ) public override onlyOwnerAllowed(posId) {
    IBookKeeper(bookKeeper).moveCollateral(collateralPools[posId], positions[posId], destination, wad);
    IGenericTokenAdapter(adapter).onMoveCollateral(positions[posId], destination, wad, data);
  }

  /// @dev Transfer wad amount of any type of collateral (collateralPoolId) from the positionHandler address to the destination address
  /// This function has the purpose to take away collateral from the system that doesn't correspond to the position but was sent there wrongly
  /// @param collateralPoolId The collateral pool id
  /// @param posId The position id to move collateral from
  /// @param destination The destination to recevied collateral
  /// @param wad The amount in wad to be moved
  /// @param adapter The adapter to be called once collateral is moved
  /// @param data The extra datat to be passed to the adapter
  function moveCollateral(
    bytes32 collateralPoolId,
    uint256 posId,
    address destination,
    uint256 wad,
    address adapter,
    bytes calldata data
  ) public onlyOwnerAllowed(posId) {
    IBookKeeper(bookKeeper).moveCollateral(collateralPoolId, positions[posId], destination, wad);
    IGenericTokenAdapter(adapter).onMoveCollateral(positions[posId], destination, wad, data);
  }

  /// @dev Transfer rad amount of stablecoin from the positionHandler address to the destination address
  /// @param posId The position id to move stablecoin from
  /// @param destination The destination to received stablecoin
  /// @param rad The amount in rad to be moved
  function moveStablecoin(
    uint256 posId,
    address destination,
    uint256 rad
  ) public override onlyOwnerAllowed(posId) {
    IBookKeeper(bookKeeper).moveStablecoin(positions[posId], destination, rad);
  }

  /// @dev Export the positions's lockedCollateral and debtShare to a different destination address
  /// The destination address must allow position's owner to do so.
  /// @param posId The position id to be exported
  /// @param destination The PositionHandler to be exported to
  function exportPosition(uint256 posId, address destination)
    public
    override
    onlyOwnerAllowed(posId)
    onlyMigrationAllowed(destination)
  {
    (uint256 lockedCollateral, uint256 debtShare) = IBookKeeper(bookKeeper).positions(
      collateralPools[posId],
      positions[posId]
    );
    IBookKeeper(bookKeeper).movePosition(
      collateralPools[posId],
      positions[posId],
      destination,
      _safeToInt(lockedCollateral),
      _safeToInt(debtShare)
    );
    emit ExportPosition(posId, positions[posId], destination, lockedCollateral, debtShare);
  }

  /// @dev Import lockedCollateral and debtShare from the source address to
  /// the PositionHandler owned by the PositionManager.
  /// The source address must allow position's owner to do so.
  /// @param source The source PositionHandler to be moved to this PositionManager
  /// @param posId The position id to be moved to this PositionManager
  function importPosition(address source, uint256 posId)
    public
    override
    onlyMigrationAllowed(source)
    onlyOwnerAllowed(posId)
  {
    (uint256 lockedCollateral, uint256 debtShare) = IBookKeeper(bookKeeper).positions(collateralPools[posId], source);
    IBookKeeper(bookKeeper).movePosition(
      collateralPools[posId],
      source,
      positions[posId],
      _safeToInt(lockedCollateral),
      _safeToInt(debtShare)
    );
    emit ImportPosition(posId, source, positions[posId], lockedCollateral, debtShare);
  }

  /// @dev Move position's lockedCollateral and debtShare
  /// from the source PositionHandler to the destination PositionHandler
  /// @param sourceId The source PositionHandler
  /// @param destinationId The destination PositionHandler
  function movePosition(uint256 sourceId, uint256 destinationId)
    public
    override
    onlyOwnerAllowed(sourceId)
    onlyOwnerAllowed(destinationId)
  {
    require(collateralPools[sourceId] == collateralPools[destinationId], "!same collateral pool");
    (uint256 lockedCollateral, uint256 debtShare) = IBookKeeper(bookKeeper).positions(
      collateralPools[sourceId],
      positions[sourceId]
    );
    IBookKeeper(bookKeeper).movePosition(
      collateralPools[sourceId],
      positions[sourceId],
      positions[destinationId],
      _safeToInt(lockedCollateral),
      _safeToInt(debtShare)
    );
    emit MovePosition(sourceId, destinationId, lockedCollateral, debtShare);
  }

  /// @dev Redeem locked collateral from a position when emergency shutdown is activated
  /// @param posId The position id to be adjusted
  /// @param adapter The adapter to be called once the position is adjusted
  /// @param data The extra data for adapter
  function redeemLockedCollateral(
    uint256 posId,
    address adapter,
    bytes calldata data
  ) public onlyOwnerAllowed(posId) {
    address positionAddress = positions[posId];
    IShowStopper(showStopper).redeemLockedCollateral(
      collateralPools[posId],
      IGenericTokenAdapter(adapter),
      positionAddress,
      data
    );
  }
}
