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

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IBookKeeper.sol";
import "../interfaces/IAuctioneer.sol";
import "../interfaces/ILiquidationEngine.sol";
import "../interfaces/IPriceFeed.sol";

interface StablecoinSavingsLike {
  function cage() external;
}

interface SystemDebtEngine {
  function cage() external;
}

interface PriceOracleLike {
  function par() external view returns (uint256);

  function collateralPools(bytes32)
    external
    view
    returns (
      IPriceFeed priceFeed,
      uint256 liquidationRatio // [ray]
    );

  function cage() external;
}

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

contract ShowStopper is OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable {
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

  modifier auth {
    require(wards[msg.sender] == 1, "End/not-authorized");
    _;
  }

  // --- Data ---
  IBookKeeper public bookKeeper; // CDP Engine
  ILiquidationEngine public liquidationEngine;
  SystemDebtEngine public systemDebtEngine; // Debt Engine
  StablecoinSavingsLike public stablecoinSavings;
  PriceOracleLike public priceOracle;

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
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    wards[msg.sender] = 1;
    live = 1;
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
  function file(bytes32 what, address data) external auth {
    require(live == 1, "End/not-live");
    if (what == "bookKeeper") bookKeeper = IBookKeeper(data);
    else if (what == "liquidationEngine") liquidationEngine = ILiquidationEngine(data);
    else if (what == "systemDebtEngine") systemDebtEngine = SystemDebtEngine(data);
    else if (what == "stablecoinSavings") stablecoinSavings = StablecoinSavingsLike(data);
    else if (what == "priceOracle") priceOracle = PriceOracleLike(data);
    else revert("End/file-unrecognized-param");
    emit File(what, data);
  }

  function file(bytes32 what, uint256 data) external auth {
    require(live == 1, "End/not-live");
    if (what == "wait") wait = data;
    else revert("End/file-unrecognized-param");
    emit File(what, data);
  }

  // --- Settlement ---
  function cage() external auth {
    require(live == 1, "End/not-live");
    live = 0;
    when = block.timestamp;
    bookKeeper.cage();
    liquidationEngine.cage();
    systemDebtEngine.cage();
    priceOracle.cage();
    stablecoinSavings.cage();
    emit Cage();
  }

  function cage(bytes32 collateralPoolId) external {
    require(live == 0, "End/still-live");
    require(cagePrice[collateralPoolId] == 0, "End/cagePrice-collateralPoolId-already-defined");
    (totalDebtShare[collateralPoolId], , , , ) = bookKeeper.collateralPools(collateralPoolId);
    (IPriceFeed priceFeed, ) = priceOracle.collateralPools(collateralPoolId);
    // par is a ray, priceFeed returns a wad
    cagePrice[collateralPoolId] = wdiv(priceOracle.par(), uint256(priceFeed.read()));
    emit Cage(collateralPoolId);
  }

  function snip(bytes32 collateralPoolId, uint256 id) external {
    require(cagePrice[collateralPoolId] != 0, "End/cagePrice-collateralPoolId-not-defined");

    (address _auctioneer, , , ) = liquidationEngine.collateralPools(collateralPoolId);
    IAuctioneer auctioneer = IAuctioneer(_auctioneer);
    (, uint256 debtAccumulatedRate, , , ) = bookKeeper.collateralPools(collateralPoolId);
    (, uint256 tab, uint256 lot, address usr, , ) = auctioneer.sales(id);

    bookKeeper.mintUnbackedStablecoin(address(systemDebtEngine), address(systemDebtEngine), tab);
    auctioneer.yank(id);

    uint256 debtShare = tab / debtAccumulatedRate;
    totalDebtShare[collateralPoolId] = add(totalDebtShare[collateralPoolId], debtShare);
    require(int256(lot) >= 0 && int256(debtShare) >= 0, "End/overflow");
    bookKeeper.confiscatePosition(
      collateralPoolId,
      usr,
      address(this),
      address(systemDebtEngine),
      int256(lot),
      int256(debtShare)
    );
    emit Snip(collateralPoolId, id, usr, tab, lot, debtShare);
  }

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

  function thaw() external {
    require(live == 0, "End/still-live");
    require(debt == 0, "End/debt-not-zero");
    require(bookKeeper.stablecoin(address(systemDebtEngine)) == 0, "End/surplus-not-zero");
    require(block.timestamp >= add(when, wait), "End/wait-not-finished");
    debt = bookKeeper.totalStablecoinIssued();
    emit Thaw();
  }

  function flow(bytes32 collateralPoolId) external {
    require(debt != 0, "End/debt-zero");
    require(finalCashPrice[collateralPoolId] == 0, "End/finalCashPrice-collateralPoolId-already-defined");

    (, uint256 debtAccumulatedRate, , , ) = bookKeeper.collateralPools(collateralPoolId);
    uint256 wad = rmul(rmul(totalDebtShare[collateralPoolId], debtAccumulatedRate), cagePrice[collateralPoolId]);
    finalCashPrice[collateralPoolId] = mul(sub(wad, shortfall[collateralPoolId]), RAY) / (debt / RAY);
    emit Flow(collateralPoolId);
  }

  function pack(uint256 wad) external {
    require(debt != 0, "End/debt-zero");
    bookKeeper.moveStablecoin(msg.sender, address(systemDebtEngine), mul(wad, RAY));
    bag[msg.sender] = add(bag[msg.sender], wad);
    emit Pack(msg.sender, wad);
  }

  function cash(bytes32 collateralPoolId, uint256 wad) external {
    require(finalCashPrice[collateralPoolId] != 0, "End/finalCashPrice-collateralPoolId-not-defined");
    bookKeeper.moveCollateral(collateralPoolId, address(this), msg.sender, rmul(wad, finalCashPrice[collateralPoolId]));
    out[collateralPoolId][msg.sender] = add(out[collateralPoolId][msg.sender], wad);
    require(out[collateralPoolId][msg.sender] <= bag[msg.sender], "End/insufficient-bag-balance");
    emit Cash(collateralPoolId, msg.sender, wad);
  }
}
