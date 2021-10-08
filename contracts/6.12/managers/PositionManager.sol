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
  /// @dev Mapping of positionId => positionHandler
  mapping(uint256 => address) public override positions;
  /// @dev Mapping of positionId => prev & next positionId; Double linked list
  mapping(uint256 => List) public list;
  /// @dev Mapping of positionId => owner
  mapping(uint256 => address) public override owners;
  /// @dev Mapping of positionHandler => owner
  mapping(address => address) public override mapPositionHandlerToOwner;
  /// @dev Mapping of positionId => collateralPool
  mapping(uint256 => bytes32) public override collateralPools;

  /// @dev Mapping of owner => the first positionId
  mapping(address => uint256) public ownerFirstPositionId;
  /// @dev Mapping of owner => the last positionId
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

  event NewPosition(address indexed usr, address indexed own, uint256 indexed positionId);
  event AllowManagePosition(
    address indexed caller,
    uint256 indexed positionId,
    address owner,
    address user,
    uint256 ok
  );
  event AllowMigratePosition(address indexed caller, address user, uint256 ok);
  event ExportPosition(
    uint256 indexed positionId,
    address source,
    address destination,
    uint256 lockedCollateral,
    uint256 debtShare
  );
  event ImportPosition(
    uint256 indexed positionId,
    address source,
    address destination,
    uint256 lockedCollateral,
    uint256 debtShare
  );
  event MovePosition(uint256 sourceId, uint256 destinationId, uint256 lockedCollateral, uint256 debtShare);

  /// @dev Require that the caller must be position's owner or owner whitelist
  modifier onlyOwnerAllowed(uint256 positionId) {
    require(
      msg.sender == owners[positionId] || ownerWhitelist[owners[positionId]][positionId][msg.sender] == 1,
      "owner not allowed"
    );
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
  /// @param positionId The position id
  /// @param user The address to be allowed for managing the position
  /// @param ok Ok flag to allow/disallow. 1 for allow and 0 for disallow.
  function allowManagePosition(
    uint256 positionId,
    address user,
    uint256 ok
  ) public override onlyOwnerAllowed(positionId) {
    ownerWhitelist[owners[positionId]][positionId][user] = ok;
    emit AllowManagePosition(msg.sender, positionId, owners[positionId], user, ok);
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
  /// @param positionId The position id to be given away ownership
  /// @param destination The destination to be a new owner of the position
  function give(uint256 positionId, address destination) public override onlyOwnerAllowed(positionId) {
    require(destination != address(0), "destination address(0)");
    require(destination != owners[positionId], "destination already owner");

    // Remove transferred position from double linked list of origin user and pointers
    if (list[positionId].prev != 0) {
      // Set the next pointer of the prev position (if exists) to the next of the transferred one
      list[list[positionId].prev].next = list[positionId].next;
    }

    if (list[positionId].next != 0) {
      // If wasn't the last one
      // Set the prev pointer of the next position to the prev of the transferred one
      list[list[positionId].next].prev = list[positionId].prev;
    } else {
      // If was the last one
      // Update last pointer of the owner
      ownerLastPositionId[owners[positionId]] = list[positionId].prev;
    }

    if (ownerFirstPositionId[owners[positionId]] == positionId) {
      // If was the first one
      // Update first pointer of the owner
      ownerFirstPositionId[owners[positionId]] = list[positionId].next;
    }
    ownerPositionCount[owners[positionId]] = _safeSub(ownerPositionCount[owners[positionId]], 1);

    // Transfer ownership
    owners[positionId] = destination;
    mapPositionHandlerToOwner[positions[positionId]] = destination;

    // Add transferred position to double linked list of destiny user and pointers
    list[positionId].prev = ownerLastPositionId[destination];
    list[positionId].next = 0;
    if (ownerLastPositionId[destination] != 0) {
      list[ownerLastPositionId[destination]].next = positionId;
    }
    if (ownerFirstPositionId[destination] == 0) {
      ownerFirstPositionId[destination] = positionId;
    }
    ownerLastPositionId[destination] = positionId;
    ownerPositionCount[destination] = _safeAdd(ownerPositionCount[destination], 1);
  }

  /// @dev Adjust the position keeping the generated stablecoin
  /// or collateral freed in the positionHandler address.
  /// @param positionId The position id to be adjusted
  /// @param collateralValue The collateralValue to be adjusted
  /// @param debtShare The debtShare to be adjusted
  /// @param adapter The adapter to be called once the position is adjusted
  /// @param data The extra data for adapter
  function adjustPosition(
    uint256 positionId,
    int256 collateralValue,
    int256 debtShare,
    address adapter,
    bytes calldata data
  ) public override onlyOwnerAllowed(positionId) {
    address positionAddress = positions[positionId];
    IBookKeeper(bookKeeper).adjustPosition(
      collateralPools[positionId],
      positionAddress,
      positionAddress,
      positionAddress,
      collateralValue,
      debtShare
    );
    IGenericTokenAdapter(adapter).onAdjustPosition(positionAddress, positionAddress, collateralValue, debtShare, data);
  }

  /// @dev Transfer wad amount of position's collateral from the positionHandler address to a destination address.
  /// @param positionId The position id to move collateral from
  /// @param destination The destination to received collateral
  /// @param wad The amount in wad to be moved
  /// @param adapter The adapter to be called when collateral has been moved
  /// @param data The extra data for the adapter
  function moveCollateral(
    uint256 positionId,
    address destination,
    uint256 wad,
    address adapter,
    bytes calldata data
  ) public override onlyOwnerAllowed(positionId) {
    IBookKeeper(bookKeeper).moveCollateral(collateralPools[positionId], positions[positionId], destination, wad);
    IGenericTokenAdapter(adapter).onMoveCollateral(positions[positionId], destination, wad, data);
  }

  /// @dev Transfer wad amount of any type of collateral (collateralPoolId) from the positionHandler address to the destination address
  /// This function has the purpose to take away collateral from the system that doesn't correspond to the position but was sent there wrongly
  /// @param collateralPoolId The collateral pool id
  /// @param positionId The position id to move collateral from
  /// @param destination The destination to recevied collateral
  /// @param wad The amount in wad to be moved
  /// @param adapter The adapter to be called once collateral is moved
  /// @param data The extra datat to be passed to the adapter
  function moveCollateral(
    bytes32 collateralPoolId,
    uint256 positionId,
    address destination,
    uint256 wad,
    address adapter,
    bytes calldata data
  ) public onlyOwnerAllowed(positionId) {
    IBookKeeper(bookKeeper).moveCollateral(collateralPoolId, positions[positionId], destination, wad);
    IGenericTokenAdapter(adapter).onMoveCollateral(positions[positionId], destination, wad, data);
  }

  /// @dev Transfer rad amount of stablecoin from the positionHandler address to the destination address
  /// @param positionId The position id to move stablecoin from
  /// @param destination The destination to received stablecoin
  /// @param rad The amount in rad to be moved
  function moveStablecoin(
    uint256 positionId,
    address destination,
    uint256 rad
  ) public override onlyOwnerAllowed(positionId) {
    IBookKeeper(bookKeeper).moveStablecoin(positions[positionId], destination, rad);
  }

  /// @dev Export the positions's lockedCollateral and debtShare to a different destination address
  /// The destination address must allow position's owner to do so.
  /// @param positionId The position id to be exported
  /// @param destination The PositionHandler to be exported to
  function exportPosition(uint256 positionId, address destination)
    public
    override
    onlyOwnerAllowed(positionId)
    onlyMigrationAllowed(destination)
  {
    (uint256 lockedCollateral, uint256 debtShare) = IBookKeeper(bookKeeper).positions(
      collateralPools[positionId],
      positions[positionId]
    );
    IBookKeeper(bookKeeper).movePosition(
      collateralPools[positionId],
      positions[positionId],
      destination,
      _safeToInt(lockedCollateral),
      _safeToInt(debtShare)
    );
    emit ExportPosition(positionId, positions[positionId], destination, lockedCollateral, debtShare);
  }

  /// @dev Import lockedCollateral and debtShare from the source address to
  /// the PositionHandler owned by the PositionManager.
  /// The source address must allow position's owner to do so.
  /// @param source The source PositionHandler to be moved to this PositionManager
  /// @param positionId The position id to be moved to this PositionManager
  function importPosition(address source, uint256 positionId)
    public
    override
    onlyMigrationAllowed(source)
    onlyOwnerAllowed(positionId)
  {
    (uint256 lockedCollateral, uint256 debtShare) = IBookKeeper(bookKeeper).positions(
      collateralPools[positionId],
      source
    );
    IBookKeeper(bookKeeper).movePosition(
      collateralPools[positionId],
      source,
      positions[positionId],
      _safeToInt(lockedCollateral),
      _safeToInt(debtShare)
    );
    emit ImportPosition(positionId, source, positions[positionId], lockedCollateral, debtShare);
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
