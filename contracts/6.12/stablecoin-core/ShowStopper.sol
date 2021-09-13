// SPDX-License-Identifier: AGPL-3.0-or-later

/// end.sol -- global settlement engine

// Copyright (C) 2018 Rain <rainbreak@riseup.net>
// Copyright (C) 2018 Lev Livnev <lev@liv.nev.org.uk>
// Copyright (C) 2020-2021 Maker Ecosystem Growth Holdings, INC.
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

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IBookKeeper.sol";
import "../interfaces/IAuctioneer.sol";
import "../interfaces/ILiquidationEngine.sol";
import "../interfaces/IPriceFeed.sol";
import "../interfaces/IPriceOracle.sol";
import "../interfaces/ISystemDebtEngine.sol";

/*
    This is the `End` and it coordinates Global Settlement. This is an
    involved, stateful process that takes place over nine steps.

    First we freeze the system and lock the prices for each collateralPoolId.

    1. `cage()`:
        - freezes user entrypoints
        - cancels flop/flap auctions
        - starts cooldown period
        - stops pot drips

    2. `cage(collateralPoolId)`:
       - set the cage price for each `collateralPoolId`, reading off the price feed

    We must process some system state before it is possible to calculate
    the final dai / collateral price. In particular, we need to determine

      a. `shortfall`, the collateral shortfall per collateral type by
         considering under-collateralised CDPs.

      b. `debt`, the outstanding dai supply after including system
         surplus / deficit

    We determine (a) by processing all under-collateralised CDPs with
    `skim`:

    3. `skim(collateralPoolId, urn)`:
       - cancels CDP debt
       - any excess collateral remains
       - backing collateral taken

    We determine (b) by processing ongoing dai generating processes,
    i.e. auctions. We need to ensure that auctions will not generate any
    further dai income.

    In the two-way auction model (Flipper) this occurs when
    all auctions are in the reverse (`dent`) phase. There are two ways
    of ensuring this:

    4a. i) `wait`: set the cooldown period to be at least as long as the
           longest auction duration, which needs to be determined by the
           cage administrator.

           This takes a fairly predictable time to occur but with altered
           auction dynamics due to the now varying price of dai.

       ii) `skip`: cancel all ongoing auctions and seize the collateral.

           This allows for faster processing at the expense of more
           processing calls. This option allows dai holders to retrieve
           their collateral faster.

           `skip(collateralPoolId, id)`:
            - cancel individual flip auctions in the `tend` (forward) phase
            - retrieves collateral and debt (including penalty) to owner's CDP
            - returns dai to last bidder
            - `dent` (reverse) phase auctions can continue normally

    Option (i), `wait`, is sufficient (if all auctions were bidded at least
    once) for processing the system settlement but option (ii), `skip`,
    will speed it up. Both options are available in this implementation,
    with `skip` being enabled on a per-auction basis.

    In the case of the Dutch Auctions model (Clipper) they keep recovering
    debt during the whole lifetime and there isn't a max duration time
    guaranteed for the auction to end.
    So the way to ensure the protocol will not receive extra dai income is:

    4b. i) `snip`: cancel all ongoing auctions and seize the collateral.

           `snip(collateralPoolId, id)`:
            - cancel individual running clip auctions
            - retrieves remaining collateral and debt (including penalty)
              to owner's CDP

    When a CDP has been processed and has no debt remaining, the
    remaining collateral can be removed.

    5. `free(collateralPoolId)`:
        - remove collateral from the caller's CDP
        - owner can call as needed

    After the processing period has elapsed, we enable calculation of
    the final price for each collateral type.

    6. `thaw()`:
       - only callable after processing time period elapsed
       - assumption that all under-collateralised CDPs are processed
       - fixes the total outstanding supply of dai
       - may also require extra CDP processing to cover systemDebtEngine surplus

    7. `flow(collateralPoolId)`:
        - calculate the `fix`, the cash price for a given collateralPoolId
        - adjusts the `fix` in the case of deficit / surplus

    At this point we have computed the final price for each collateral
    type and dai holders can now turn their dai into collateral. Each
    unit dai can claim a fixed basket of collateral.

    Dai holders must first `pack` some dai into a `bag`. Once packed,
    dai cannot be unpacked and is not transferrable. More dai can be
    added to a bag later.

    8. `pack(wad)`:
        - put some dai into a bag in preparation for `cash`

    Finally, collateral can be obtained with `cash`. The bigger the bag,
    the more collateral can be released.

    9. `cash(collateralPoolId, wad)`:
        - exchange some dai from your bag for gems from a specific collateralPoolId
        - the number of gems is limited by how big your bag is
*/

contract ShowStopper is PausableUpgradeable, AccessControlUpgradeable {
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;

  // --- Data ---
  IBookKeeper public bookKeeper; // CDP Engine
  ILiquidationEngine public liquidationEngine;
  ISystemDebtEngine public systemDebtEngine; // Debt Engine
  IPriceOracle public priceOracle;

  uint256 public live; // Active Flag
  uint256 public when; // Time of cage                   [unix epoch time]
  uint256 public wait; // Processing Cooldown Length             [seconds]
  uint256 public debt; // Total outstanding dai following processing [rad]

  mapping(bytes32 => uint256) public cagePrice; // Cage price              [ray]
  mapping(bytes32 => uint256) public shortfall; // Collateral shortfall    [wad]
  mapping(bytes32 => uint256) public totalDebtShare; // Total debt per collateralPoolId      [wad]
  mapping(bytes32 => uint256) public finalCashPrice; // Final cash price        [ray]

  mapping(address => uint256) public bag; //    [wad]
  mapping(bytes32 => mapping(address => uint256)) public out; //    [wad]

  // --- Events ---
  event Rely(address indexed usr);
  event Deny(address indexed usr);

  event File(bytes32 indexed what, uint256 data);
  event File(bytes32 indexed what, address data);

  event Cage();
  event Cage(bytes32 indexed collateralPoolId);
  event Snip(
    bytes32 indexed collateralPoolId,
    uint256 indexed id,
    address indexed usr,
    uint256 tab,
    uint256 lot,
    uint256 art
  );
  event Skip(
    bytes32 indexed collateralPoolId,
    uint256 indexed id,
    address indexed usr,
    uint256 tab,
    uint256 lot,
    uint256 art
  );
  event Skim(bytes32 indexed collateralPoolId, address indexed urn, uint256 wad, uint256 art);
  event Free(bytes32 indexed collateralPoolId, address indexed usr, uint256 ink);
  event Thaw();
  event Flow(bytes32 indexed collateralPoolId);
  event Pack(address indexed usr, uint256 wad);
  event Cash(bytes32 indexed collateralPoolId, address indexed usr, uint256 wad);

  // --- Init ---
  function initialize() external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    live = 1;

    // Grant the contract deployer the default admin role: it will be able
    // to grant and revoke any roles
    _setupRole(OWNER_ROLE, msg.sender);
    emit Rely(msg.sender);
  }

  // --- Math ---
  uint256 constant WAD = 10**18;
  uint256 constant RAY = 10**27;

  function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = x + y;
    require(z >= x);
  }

  function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x - y) <= x);
  }

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x);
  }

  function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
    return x <= y ? x : y;
  }

  function rmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = mul(x, y) / RAY;
  }

  function wdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = mul(x, WAD) / y;
  }

  // --- Administration ---
  event SetBookKeeper(address indexed caller, address data);
  event SetLiquidationEngine(address indexed caller, address data);
  event SetSystemDebtEngine(address indexed caller, address data);
  event SetPriceOracle(address indexed caller, address data);
  event SetWait(address indexed caller, uint256 data);

  function setBookKeeper(address _data) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "End/not-live");
    bookKeeper = IBookKeeper(_data);
    emit SetBookKeeper(msg.sender, _data);
  }

  function setLiquidationEngine(address _data) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "End/not-live");
    liquidationEngine = ILiquidationEngine(_data);
    emit SetLiquidationEngine(msg.sender, _data);
  }

  function setSystemDebtEngine(address _data) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "End/not-live");
    systemDebtEngine = ISystemDebtEngine(_data);
    emit SetSystemDebtEngine(msg.sender, _data);
  }

  function setPriceOracle(address _data) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "End/not-live");
    priceOracle = IPriceOracle(_data);
    emit SetPriceOracle(msg.sender, _data);
  }

  function setWait(uint256 _data) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "End/not-live");
    wait = _data;
    emit SetWait(msg.sender, _data);
  }

  // --- Settlement ---
  /** @dev Start the process of emergency shutdown. The following will happen in order:
      - Start a cooldown period of the emergency shutdown
      - BookKeeper will be paused: locking/unlocking collateral and mint/repay Alpaca Stablecoin will not be allow for any positions
      - LiquidationEngine will be paused: positions will not be liquidated
      - SystemDebtEngine will be paused: no accrual of new debt, no system debt settlement
      - PriceOracle will be paused: no new price update, no liquidation trigger
   */
  function cage() external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "End/not-live");
    live = 0;
    when = block.timestamp;
    bookKeeper.cage();
    liquidationEngine.cage();
    systemDebtEngine.cage();
    priceOracle.cage();
    emit Cage();
  }

  /// @dev Set the cage price of the collateral pool with the latest price from the price oracle
  /// @param collateralPoolId Collateral pool id
  function cage(bytes32 collateralPoolId) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 0, "End/still-live");
    require(cagePrice[collateralPoolId] == 0, "End/cagePrice-collateralPoolId-already-defined");
    (totalDebtShare[collateralPoolId], , , , ) = bookKeeper.collateralPools(collateralPoolId);
    (IPriceFeed priceFeed, ) = priceOracle.collateralPools(collateralPoolId);
    // par is a ray, priceFeed returns a wad
    cagePrice[collateralPoolId] = wdiv(priceOracle.stableCoinReferencePrice(), uint256(priceFeed.read()));
    emit Cage(collateralPoolId);
  }

  /** @dev Inspect the specified position and use the cage price of the collateral pool id to calculate the current shortfall of the position.
      The shortfall will be tracked per collateral pool. It will be used in the determination of the stablecoin redemption price 
      to make sure that all shortfall will be covered. This process will clear the debt from the position.
      `skim` is used with the English Auction Liquidation of MakerDAO in Liquidation 1.0
  */
  /// @param collateralPoolId Collateral pool id
  /// @param urn Position address
  function skim(bytes32 collateralPoolId, address urn) external {
    require(cagePrice[collateralPoolId] != 0, "End/cagePrice-collateralPoolId-not-defined");
    (, uint256 debtAccumulatedRate, , , ) = bookKeeper.collateralPools(collateralPoolId);
    (uint256 lockedCollateral, uint256 debtShare) = bookKeeper.positions(collateralPoolId, urn);

    uint256 owe = rmul(rmul(debtShare, debtAccumulatedRate), cagePrice[collateralPoolId]);
    uint256 wad = min(lockedCollateral, owe);
    shortfall[collateralPoolId] = add(shortfall[collateralPoolId], sub(owe, wad));

    require(wad <= 2**255 && debtShare <= 2**255, "End/overflow");
    bookKeeper.confiscatePosition(
      collateralPoolId,
      urn,
      address(this),
      address(systemDebtEngine),
      -int256(wad),
      -int256(debtShare)
    );
    emit Skim(collateralPoolId, urn, wad, debtShare);
  }

  /** @dev Free the collateral from the position which has been safely settled by the emergency shutdown and give the collateral back to the position owner.
      The position to be freed must has no debt at all. That means it must have gone through the process of `skim` or `smip` already.
      The position will be limited to the caller address. If the position address is not an EOA address but is managed by a position manager contract,
      the owner of the position will have to move the collateral inside the position to the owner address first before calling `free`.
  */
  /// @param collateralPoolId Collateral pool id
  function free(bytes32 collateralPoolId) external {
    require(live == 0, "End/still-live");
    (uint256 lockedCollateral, uint256 debtShare) = bookKeeper.positions(collateralPoolId, msg.sender);
    require(debtShare == 0, "End/debtShare-not-zero");
    require(lockedCollateral <= 2**255, "End/overflow");
    bookKeeper.confiscatePosition(
      collateralPoolId,
      msg.sender,
      msg.sender,
      address(systemDebtEngine),
      -int256(lockedCollateral),
      0
    );
    emit Free(collateralPoolId, msg.sender, lockedCollateral);
  }

  /** @dev Finalize the total debt of the system after the emergency shutdown.
      This function should be called after:
      - Every positions has undergone `skim` or `snip` to settle all the debt.
      - System surplus must be zero, this means all surplus should be used to settle bad debt already.
      - The emergency shutdown cooldown period must have passed.
      This total debt will be equivalent to the total stablecoin issued which should already reflect 
      the correct value if all the above requirements before calling `thaw` are satisfied.
  */
  function thaw() external {
    require(live == 0, "End/still-live");
    require(debt == 0, "End/debt-not-zero");
    require(bookKeeper.stablecoin(address(systemDebtEngine)) == 0, "End/surplus-not-zero");
    require(block.timestamp >= add(when, wait), "End/wait-not-finished");
    debt = bookKeeper.totalStablecoinIssued();
    emit Thaw();
  }

  /** @dev Calculate the cash price of the collateral pool id.
      The cash price is the price where the Alpaca Stablecoin owner will be entitled to when redeeming from Alpaca Stablecoin -> collateral token.
      The cash price will take into account the deficit/surplus of this collateral pool and calculate the price so that any bad debt will be covered.
  */
  /// @param collateralPoolId Collateral pool id
  function flow(bytes32 collateralPoolId) external {
    require(debt != 0, "End/debt-zero");
    require(finalCashPrice[collateralPoolId] == 0, "End/finalCashPrice-collateralPoolId-already-defined");

    (, uint256 debtAccumulatedRate, , , ) = bookKeeper.collateralPools(collateralPoolId);
    uint256 wad = rmul(rmul(totalDebtShare[collateralPoolId], debtAccumulatedRate), cagePrice[collateralPoolId]);
    finalCashPrice[collateralPoolId] = mul(sub(wad, shortfall[collateralPoolId]), RAY) / (debt / RAY);
    emit Flow(collateralPoolId);
  }

  /// @dev Pack the deposited stablecoin of the caller into a bag to be cashed out into collateral token later
  /// @param wad the amount of stablecoin to be packed
  function pack(uint256 wad) external {
    require(debt != 0, "End/debt-zero");
    bookKeeper.moveStablecoin(msg.sender, address(systemDebtEngine), mul(wad, RAY));
    bag[msg.sender] = add(bag[msg.sender], wad);
    emit Pack(msg.sender, wad);
  }

  /// @dev Cash out all the stablecoin in the bag of the caller into the corresponding collateral token
  /// @param collateralPoolId Collateral pool id
  /// @param wad the amount of stablecoin to be cashed
  function cash(bytes32 collateralPoolId, uint256 wad) external {
    require(finalCashPrice[collateralPoolId] != 0, "End/finalCashPrice-collateralPoolId-not-defined");
    bookKeeper.moveCollateral(collateralPoolId, address(this), msg.sender, rmul(wad, finalCashPrice[collateralPoolId]));
    out[collateralPoolId][msg.sender] = add(out[collateralPoolId][msg.sender], wad);
    require(out[collateralPoolId][msg.sender] <= bag[msg.sender], "End/insufficient-bag-balance");
    emit Cash(collateralPoolId, msg.sender, wad);
  }
}
