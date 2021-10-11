// SPDX-License-Identifier: AGPL-3.0-or-later

/// ShowStopper.sol -- global settlement engine

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
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IBookKeeper.sol";
import "../interfaces/IAuctioneer.sol";
import "../interfaces/ILiquidationEngine.sol";
import "../interfaces/IPriceFeed.sol";
import "../interfaces/IPriceOracle.sol";
import "../interfaces/ISystemDebtEngine.sol";
import "../interfaces/IGenericTokenAdapter.sol";
import "../interfaces/ICagable.sol";

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

      a. `badDebtAccumulator`, the collateral badDebtAccumulator per collateral type by
         considering under-collateralised CDPs.

      b. `debt`, the outstanding dai supply after including system
         surplus / deficit

    We determine (a) by processing all under-collateralised CDPs with
    `accumulateBadDebt`:

    3. `accumulateBadDebt(collateralPoolId, urn)`:
       - cancels CDP debt
       - any excess collateral remains
       - backing collateral taken

    We determine (b) by processing ongoing dai generating processes,
    i.e. auctions. We need to ensure that auctions will not generate any
    further dai income.

    In the two-way auction model (Flipper) this occurs cagedTimestamp
    all auctions are in the reverse (`dent`) phase. There are two ways
    of ensuring this:

    4a. i) `cageCoolDown`: set the cooldown period to be at least as long as the
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

    Option (i), `cageCoolDown`, is sufficient (if all auctions were bidded at least
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

    cagedTimestamp a CDP has been processed and has no debt remaining, the
    remaining collateral can be removed.

    5. `redeemLockedCollateral(collateralPoolId)`:
        - remove collateral from the caller's CDP
        - owner can call as needed

    After the processing period has elapsed, we enable calculation of
    the final price for each collateral type.

    6. `finalizeDebt()`:
       - only callable after processing time period elapsed
       - assumption that all under-collateralised CDPs are processed
       - fixes the total outstanding supply of dai
       - may also require extra CDP processing to cover systemDebtEngine surplus

    7. `finalizeCashPrice(collateralPoolId)`:
        - calculate the `fix`, the redeemStablecoin price for a given collateralPoolId
        - adjusts the `fix` in the case of deficit / surplus

    At this point we have computed the final price for each collateral
    type and dai holders can now turn their dai into collateral. Each
    unit dai can claim a fixed basket of collateral.

    Dai holders must first `accumulateStablecoin` some dai into a `stablecoinAccumulator`. Once packed,
    dai cannot be unpacked and is not transferrable. More dai can be
    added to a stablecoinAccumulator later.

    8. `accumulateStablecoin(wad)`:
        - put some dai into a stablecoinAccumulator in preparation for `redeemStablecoin`

    Finally, collateral can be obtained with `redeemStablecoin`. The bigger the stablecoinAccumulator,
    the more collateral can be released.

    9. `redeemStablecoin(collateralPoolId, wad)`:
        - exchange some dai from your stablecoinAccumulator for gems from a specific collateralPoolId
        - the number of gems is limited by how big your stablecoinAccumulator is
*/

contract ShowStopper is PausableUpgradeable, AccessControlUpgradeable {
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;

  // --- Data ---
  IBookKeeper public bookKeeper; // CDP Engine
  ILiquidationEngine public liquidationEngine;
  ISystemDebtEngine public systemDebtEngine; // Debt Engine
  IPriceOracle public priceOracle;

  uint256 public live; // Active Flag
  uint256 public cagedTimestamp; // Time of cage                   [unix epoch time]
  uint256 public cageCoolDown; // Processing Cooldown Length             [seconds]
  uint256 public debt; // Total outstanding stablecoin following processing [rad]

  mapping(bytes32 => uint256) public cagePrice; // Cage price              [ray]
  mapping(bytes32 => uint256) public badDebtAccumulator; // Collateral badDebtAccumulator    [wad]
  mapping(bytes32 => uint256) public totalDebtShare; // Total debt per collateralPoolId      [wad]
  mapping(bytes32 => uint256) public finalCashPrice; // Final redeemStablecoin price        [ray]

  mapping(address => uint256) public stablecoinAccumulator; //    [wad]
  mapping(bytes32 => mapping(address => uint256)) public redeemedStablecoinAmount; //    [wad]

  event Cage();
  event Cage(bytes32 indexed collateralPoolId);

  event AccumulateBadDebt(
    bytes32 indexed collateralPoolId,
    address indexed positionAddress,
    uint256 amount,
    uint256 debtShare
  );
  event RedeemLockedCollateral(
    bytes32 indexed collateralPoolId,
    address indexed positionAddress,
    uint256 lockedCollateral
  );
  event FinalizeDebt();
  event FinalizeCashPrice(bytes32 indexed collateralPoolId);
  event AccumulateStablecoin(address indexed ownerAddress, uint256 amount);
  event RedeemStablecoin(bytes32 indexed collateralPoolId, address indexed ownerAddress, uint256 amount);

  // --- Init ---
  function initialize() external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    live = 1;

    // Grant the contract deployer the owner role: it will be able
    // to grant and revoke any roles
    _setupRole(OWNER_ROLE, msg.sender);
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
  event SetBookKeeper(address indexed caller, address _bookKeeper);
  event SetLiquidationEngine(address indexed caller, address _liquidationEngine);
  event SetSystemDebtEngine(address indexed caller, address _systemDebtEngine);
  event SetPriceOracle(address indexed caller, address _priceOracle);
  event SetCageCoolDown(address indexed caller, uint256 _cageCoolDown);

  function setBookKeeper(address _bookKeeper) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "ShowStopper/not-live");
    bookKeeper = IBookKeeper(_bookKeeper);
    emit SetBookKeeper(msg.sender, _bookKeeper);
  }

  function setLiquidationEngine(address _liquidationEngine) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "ShowStopper/not-live");
    liquidationEngine = ILiquidationEngine(_liquidationEngine);
    emit SetLiquidationEngine(msg.sender, _liquidationEngine);
  }

  function setSystemDebtEngine(address _systemDebtEngine) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "ShowStopper/not-live");
    systemDebtEngine = ISystemDebtEngine(_systemDebtEngine);
    emit SetSystemDebtEngine(msg.sender, _systemDebtEngine);
  }

  function setPriceOracle(address _priceOracle) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "ShowStopper/not-live");
    priceOracle = IPriceOracle(_priceOracle);
    emit SetPriceOracle(msg.sender, _priceOracle);
  }

  function setCageCoolDown(uint256 _cageCoolDown) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 1, "ShowStopper/not-live");
    cageCoolDown = _cageCoolDown;
    emit SetCageCoolDown(msg.sender, _cageCoolDown);
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
    require(live == 1, "ShowStopper/not-live");
    live = 0;
    cagedTimestamp = block.timestamp;
    ICagable(address(bookKeeper)).cage();
    ICagable(address(liquidationEngine)).cage();
    ICagable(address(systemDebtEngine)).cage();
    ICagable(address(priceOracle)).cage();
    emit Cage();
  }

  /// @dev Set the cage price of the collateral pool with the latest price from the price oracle
  /// @param collateralPoolId Collateral pool id
  function cage(bytes32 collateralPoolId) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(live == 0, "ShowStopper/still-live");
    require(cagePrice[collateralPoolId] == 0, "ShowStopper/cage-price-collateral-pool-id-already-defined");
    uint256 _totalDebtShare = bookKeeper.collateralPoolConfig().collateralPools(collateralPoolId).totalDebtShare;
    IPriceFeed _priceFeed = bookKeeper.collateralPoolConfig().collateralPools(collateralPoolId).priceFeed;
    totalDebtShare[collateralPoolId] = _totalDebtShare;
    // par is a ray, priceFeed returns a wad
    cagePrice[collateralPoolId] = wdiv(priceOracle.stableCoinReferencePrice(), uint256(_priceFeed.readPrice()));
    emit Cage(collateralPoolId);
  }

  /** @dev Inspect the specified position and use the cage price of the collateral pool id to calculate the current badDebtAccumulator of the position.
      The badDebtAccumulator will be tracked per collateral pool. It will be used in the determination of the stablecoin redemption price 
      to make sure that all badDebtAccumulator will be covered. This process will clear the debt from the position.
  */
  /// @param collateralPoolId Collateral pool id
  /// @param positionAddress Position address
  function accumulateBadDebt(bytes32 collateralPoolId, address positionAddress) external {
    require(cagePrice[collateralPoolId] != 0, "ShowStopper/cage-price-collateral-pool-id-not-defined");
    uint256 _debtAccumulatedRate = IBookKeeper(bookKeeper)
      .collateralPoolConfig()
      .collateralPools(collateralPoolId)
      .debtAccumulatedRate; // [ray]
    (uint256 lockedCollateralAmount, uint256 debtShare) = bookKeeper.positions(collateralPoolId, positionAddress);

    // find the amount of debt in the unit of collateralToken
    uint256 debtAmount = rmul(rmul(debtShare, _debtAccumulatedRate), cagePrice[collateralPoolId]); // unit = collateralToken

    // if debt > lockedCollateralAmount, that's mean bad debt occur
    uint256 amount = min(lockedCollateralAmount, debtAmount);

    // accumulate bad debt in badDebtAccumulator (if there is any)
    badDebtAccumulator[collateralPoolId] = add(badDebtAccumulator[collateralPoolId], sub(debtAmount, amount));

    require(amount <= 2**255 && debtShare <= 2**255, "ShowStopper/overflow");

    // force close the position with the best amount we could achieve
    bookKeeper.confiscatePosition(
      collateralPoolId,
      positionAddress,
      address(this),
      address(systemDebtEngine),
      -int256(amount),
      -int256(debtShare)
    );
    emit AccumulateBadDebt(collateralPoolId, positionAddress, amount, debtShare);
  }

  /** @dev Redeem locked collateral from the position which has been safely settled by the emergency shutdown and give the collateral back to the position owner.
      The position to be freed must has no debt at all. That means it must have gone through the process of `accumulateBadDebt` or `smip` already.
      The position will be limited to the caller address. If the position address is not an EOA address but is managed by a position manager contract,
      the owner of the position will have to move the collateral inside the position to the owner address first before calling `redeemLockedCollateral`.
  */
  /// @param collateralPoolId Collateral pool id
  function redeemLockedCollateral(
    bytes32 collateralPoolId,
    IGenericTokenAdapter adapter,
    address positionAddress,
    address collateralReceiver,
    bytes calldata data
  ) external {
    require(live == 0, "ShowStopper/still-live");
    require(
      positionAddress == msg.sender || bookKeeper.positionWhitelist(positionAddress, msg.sender) == 1,
      "ShowStopper/not-allowed"
    );
    (uint256 lockedCollateralAmount, uint256 debtShare) = bookKeeper.positions(collateralPoolId, positionAddress);
    require(debtShare == 0, "ShowStopper/debtShare-not-zero");
    require(lockedCollateralAmount <= 2**255, "ShowStopper/overflow");
    bookKeeper.confiscatePosition(
      collateralPoolId,
      positionAddress,
      collateralReceiver,
      address(systemDebtEngine),
      -int256(lockedCollateralAmount),
      0
    );
    adapter.onMoveCollateral(positionAddress, collateralReceiver, lockedCollateralAmount, data);
    emit RedeemLockedCollateral(collateralPoolId, collateralReceiver, lockedCollateralAmount);
  }

  /** @dev Finalize the total debt of the system after the emergency shutdown.
      This function should be called after:
      - Every positions has undergone `accumulateBadDebt` or `snip` to settle all the debt.
      - System surplus must be zero, this means all surplus should be used to settle bad debt already.
      - The emergency shutdown cooldown period must have passed.
      This total debt will be equivalent to the total stablecoin issued which should already reflect 
      the correct value if all the above requirements before calling `finalizeDebt` are satisfied.
  */
  function finalizeDebt() external {
    require(live == 0, "ShowStopper/still-live");
    require(debt == 0, "ShowStopper/debt-not-zero");
    require(bookKeeper.stablecoin(address(systemDebtEngine)) == 0, "ShowStopper/surplus-not-zero");
    require(block.timestamp >= add(cagedTimestamp, cageCoolDown), "ShowStopper/cage-cool-down-not-finished");
    debt = bookKeeper.totalStablecoinIssued();
    emit FinalizeDebt();
  }

  /** @dev Calculate the redeemStablecoin price of the collateral pool id.
      The redeemStablecoin price is the price where the Alpaca Stablecoin owner will be entitled to cagedTimestamp redeeming from Alpaca Stablecoin -> collateral token.
      The redeemStablecoin price will take into account the deficit/surplus of this collateral pool and calculate the price so that any bad debt will be covered.
  */
  /// @param collateralPoolId Collateral pool id
  function finalizeCashPrice(bytes32 collateralPoolId) external {
    require(debt != 0, "ShowStopper/debt-zero");
    require(finalCashPrice[collateralPoolId] == 0, "ShowStopper/final-cash-price-collateral-pool-id-already-defined");

    uint256 _debtAccumulatedRate = IBookKeeper(bookKeeper)
      .collateralPoolConfig()
      .collateralPools(collateralPoolId)
      .debtAccumulatedRate; // [ray]
    uint256 wad = rmul(rmul(totalDebtShare[collateralPoolId], _debtAccumulatedRate), cagePrice[collateralPoolId]);
    finalCashPrice[collateralPoolId] = mul(sub(wad, badDebtAccumulator[collateralPoolId]), RAY) / (debt / RAY);
    emit FinalizeCashPrice(collateralPoolId);
  }

  /// @dev Accumulate the deposited stablecoin of the caller into a stablecoinAccumulator to be redeemed into collateral token later
  /// @param amount the amount of stablecoin to be accumulated [wad]
  function accumulateStablecoin(uint256 amount) external {
    require(debt != 0, "ShowStopper/debt-zero");
    bookKeeper.moveStablecoin(msg.sender, address(systemDebtEngine), mul(amount, RAY));
    stablecoinAccumulator[msg.sender] = add(stablecoinAccumulator[msg.sender], amount);
    emit AccumulateStablecoin(msg.sender, amount);
  }

  /// @dev Redeem all the stablecoin in the stablecoinAccumulator of the caller into the corresponding collateral token
  /// @param collateralPoolId Collateral pool id
  /// @param amount the amount of stablecoin to be redeemed [wad]
  function redeemStablecoin(bytes32 collateralPoolId, uint256 amount) external {
    require(finalCashPrice[collateralPoolId] != 0, "ShowStopper/final-cash-price-collateral-pool-id-not-defined");
    bookKeeper.moveCollateral(
      collateralPoolId,
      address(this),
      msg.sender,
      rmul(amount, finalCashPrice[collateralPoolId])
    );
    redeemedStablecoinAmount[collateralPoolId][msg.sender] = add(
      redeemedStablecoinAmount[collateralPoolId][msg.sender],
      amount
    );
    require(
      redeemedStablecoinAmount[collateralPoolId][msg.sender] <= stablecoinAccumulator[msg.sender],
      "ShowStopper/insufficient-stablecoin-accumulator-balance"
    );
    emit RedeemStablecoin(collateralPoolId, msg.sender, amount);
  }
}
