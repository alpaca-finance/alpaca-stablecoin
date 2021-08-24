// SPDX-License-Identifier: AGPL-3.0-or-later

/// clip.sol -- Dai auction module 2.0

// Copyright (C) 2020-2021 Maker Ecosystem Growth Holdings, INC.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
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
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "../../interfaces/IPositionHandler.sol";
import "../../interfaces/IBookKeeper.sol";
import "../../interfaces/IAuctioneer.sol";
import "../../interfaces/IPriceFeed.sol";
import "../../interfaces/IPriceOracle.sol";
import "../../interfaces/ILiquidationEngine.sol";
import "../../interfaces/IFarmableTokenAdapter.sol";
import "../../interfaces/ICalculator.sol";
import "../../interfaces/IProxy.sol";
import "../../interfaces/IFlashLendingCallee.sol";
import "../../interfaces/IManager.sol";

contract FarmableTokenAuctioneer is
  OwnableUpgradeable,
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  IAuctioneer
{
  // --- Auth ---
  mapping(address => uint256) public wards;

  function rely(address positionAddress) external auth {
    wards[positionAddress] = 1;
    emit Rely(positionAddress);
  }

  function deny(address positionAddress) external auth {
    wards[positionAddress] = 0;
    emit Deny(positionAddress);
  }

  modifier auth {
    require(wards[msg.sender] == 1, "CollateralAuctioneer/not-authorized");
    _;
  }

  // --- Data ---
  bytes32 public override collateralPoolId; // Collateral type of this CollateralAuctioneer
  IBookKeeper public bookKeeper; // Core CDP Engine
  IFarmableTokenAdapter public farmableTokenAdapter;

  ILiquidationEngine public liquidationEngine; // Liquidation module
  address public systemDebtEngine; // Recipient of dai raised in auctions
  IPriceOracle public priceOracle; // Collateral price module
  ICalculator public calc; // Current price calculator
  IManager public cdpManager; // CDP Manager which interacts with the protocol

  uint256 public startingPriceBuffer; // Multiplicative factor to increase starting price                  [ray]
  uint256 public auctionTimeLimit; // Time elapsed before auction reset                                 [seconds]
  uint256 public priceDropBeforeReset; // Percentage drop before auction reset                              [ray]
  uint64 public liquidatorBountyRate; // Percentage of tab to suck from systemDebtEngine to incentivize liquidators         [wad]
  uint192 public liquidatorTip; // Flat fee to suck from systemDebtEngine to incentivize liquidators                  [rad]
  uint256 public minimumRemainingDebt; // Cache the collateralPool debtFloor times the collateralPool liquidationPenalty to prevent excessive SLOADs [rad]

  uint256 public kicks; // Total auctions
  uint256[] public active; // Array of active auction ids

  struct Sale {
    uint256 pos; // Index in active array
    uint256 debt; // Dai to raise       [rad]
    uint256 collateralAmount; // collateral to sell [wad]
    address positionAddress; // Liquidated CDP
    uint96 auctionStartBlock; // Auction start time
    uint256 startingPrice; // Starting price     [ray]
  }
  mapping(uint256 => Sale) public override sales;

  uint256 internal locked;

  // Levels for circuit breaker
  // 0: no breaker
  // 1: no new startAuction()
  // 2: no new startAuction() or redo()
  // 3: no new startAuction(), redo(), or take()
  uint256 public stopped = 0;

  // --- Events ---
  event Rely(address indexed positionAddress);
  event Deny(address indexed positionAddress);

  event File(bytes32 indexed what, uint256 data);
  event File(bytes32 indexed what, address data);

  event Kick(
    uint256 indexed id,
    uint256 startingPrice,
    uint256 debt,
    uint256 collateralAmount,
    address indexed positionAddress,
    address indexed liquidatorAddress,
    uint256 prize
  );
  event Take(
    uint256 indexed id,
    uint256 maxPrice,
    uint256 price,
    uint256 owe,
    uint256 debt,
    uint256 collateralAmount,
    address indexed positionAddress
  );
  event Redo(
    uint256 indexed id,
    uint256 startingPrice,
    uint256 debt,
    uint256 collateralAmount,
    address indexed positionAddress,
    address indexed liquidatorAddress,
    uint256 prize
  );

  event Yank(uint256 id);

  // --- Init ---
  function initialize(
    address _bookKeeper,
    address priceOracle_,
    address liquidationEngine_,
    address farmableTokenAdapter_,
    address cdpManager_
  ) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    bookKeeper = IBookKeeper(_bookKeeper);
    priceOracle = IPriceOracle(priceOracle_);
    liquidationEngine = ILiquidationEngine(liquidationEngine_);
    farmableTokenAdapter = IFarmableTokenAdapter(farmableTokenAdapter_);
    collateralPoolId = IFarmableTokenAdapter(farmableTokenAdapter_).collateralPoolId();
    cdpManager = IManager(cdpManager_);
    startingPriceBuffer = RAY;
    wards[msg.sender] = 1;
    emit Rely(msg.sender);
  }

  // --- Synchronization ---
  modifier lock {
    require(locked == 0, "CollateralAuctioneer/system-locked");
    locked = 1;
    _;
    locked = 0;
  }

  modifier isStopped(uint256 level) {
    require(stopped < level, "CollateralAuctioneer/stopped-incorrect");
    _;
  }

  // --- Administration ---
  function file(bytes32 what, uint256 data) external auth lock {
    if (what == "startingPriceBuffer") startingPriceBuffer = data;
    else if (what == "auctionTimeLimit")
      auctionTimeLimit = data; // Time elapsed before auction reset
    else if (what == "priceDropBeforeReset")
      priceDropBeforeReset = data; // Percentage drop before auction reset
    else if (what == "liquidatorBountyRate")
      liquidatorBountyRate = uint64(data); // Percentage of debt to incentivize (max: 2^64 - 1 => 18.xxx WAD = 18xx%)
    else if (what == "liquidatorTip")
      liquidatorTip = uint192(data); // Flat fee to incentivize liquidators (max: 2^192 - 1 => 6.277T RAD)
    else if (what == "stopped")
      stopped = data; // Set breaker (0, 1, 2, or 3)
    else revert("CollateralAuctioneer/file-unrecognized-param");
    emit File(what, data);
  }

  function file(bytes32 what, address data) external auth lock {
    if (what == "priceOracle") priceOracle = IPriceOracle(data);
    else if (what == "liquidationEngine") liquidationEngine = ILiquidationEngine(data);
    else if (what == "systemDebtEngine") systemDebtEngine = data;
    else if (what == "calc") calc = ICalculator(data);
    else if (what == "cdpManager") cdpManager = IManager(data);
    else revert("CollateralAuctioneer/file-unrecognized-param");
    emit File(what, data);
  }

  // --- Math ---
  uint256 constant BLN = 10**9;
  uint256 constant WAD = 10**18;
  uint256 constant RAY = 10**27;

  function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = x <= y ? x : y;
  }

  function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x + y) >= x);
  }

  function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x - y) <= x);
  }

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x);
  }

  function wmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = mul(x, y) / WAD;
  }

  function rmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = mul(x, y) / RAY;
  }

  function rdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = mul(x, RAY) / y;
  }

  // --- Auction ---

  // get the price directly from the OSM
  // Could get this from rmul(BookKeeper.collateralPools(collateralPoolId).spot, Spotter.mat()) instead, but
  // if mat has changed since the last poke, the resulting value will be
  // incorrect.
  function getFeedPrice() internal returns (uint256 feedPrice) {
    (IPriceFeed priceFeed, ) = priceOracle.collateralPools(collateralPoolId);
    (bytes32 val, bool has) = priceFeed.peek();
    require(has, "CollateralAuctioneer/invalid-price");
    feedPrice = rdiv(mul(uint256(val), BLN), priceOracle.stableCoinReferencePrice());
  }

  // start an auction
  // note: trusts the caller to transfer collateral to the contract
  // The starting price `startingPrice` is obtained as follows:
  //
  //     startingPrice = val * startingPriceBuffer / par
  //
  // Where `val` is the collateral's unitary value in USD, `startingPriceBuffer` is a
  // multiplicative factor to increase the starting price, and `par` is a
  // reference per DAI.
  function startAuction(
    uint256 debt, // Debt                   [rad]
    uint256 collateralAmount, // Collateral             [wad]
    address positionAddress, // Address that will receive any leftover collateral
    address liquidatorAddress // Address that will receive incentives
  ) external override auth lock isStopped(1) returns (uint256 id) {
    // Input validation
    require(debt > 0, "CollateralAuctioneer/zero-debt");
    require(collateralAmount > 0, "CollateralAuctioneer/zero-collateralAmount");
    require(positionAddress != address(0), "CollateralAuctioneer/zero-positionAddress");
    id = ++kicks;
    require(id > 0, "CollateralAuctioneer/overflow");

    active.push(id);

    sales[id].pos = active.length - 1;

    sales[id].debt = debt;
    sales[id].collateralAmount = collateralAmount;
    sales[id].positionAddress = positionAddress;
    sales[id].auctionStartBlock = uint96(block.timestamp);

    uint256 startingPrice;
    startingPrice = rmul(getFeedPrice(), startingPriceBuffer);
    require(startingPrice > 0, "CollateralAuctioneer/zero-starting-price");
    sales[id].startingPrice = startingPrice;

    // incentive to kick auction
    uint256 _liquidatorTip = liquidatorTip;
    uint256 _liquidatorBountyRate = liquidatorBountyRate;
    uint256 prize;
    if (_liquidatorTip > 0 || _liquidatorBountyRate > 0) {
      prize = add(_liquidatorTip, wmul(debt, _liquidatorBountyRate));
      bookKeeper.mintUnbackedStablecoin(systemDebtEngine, liquidatorAddress, prize);
    }

    // Handle Farmable Token upon liquidation
    // 1. Harvest the rewards of this CDP owner and distribute to the CDP Owner
    address positionOwner = cdpManager.mapPositionHandlerToOwner(positionAddress);
    if(positionOwner == address(0)) positionOwner = positionAddress; // If CDP Owner is not foudn from CDP Manager, this means the positionAddress is actually the EOA address
    farmableTokenAdapter.deposit(positionAddress, 0, abi.encode(positionOwner));
    // 2. Confiscate and move the rewards and the staked collateral to this address, they will be distributed to the bidder later
    farmableTokenAdapter.moveRewards(positionAddress, address(this), collateralAmount, abi.encode(0));

    emit Kick(id, startingPrice, debt, collateralAmount, positionAddress, liquidatorAddress, prize);
  }

  // Reset an auction
  // See `kick` above for an explanation of the computation of `startingPrice`.
  function redo(
    uint256 id, // id of the auction to reset
    address liquidatorAddress // Address that will receive incentives
  ) external lock isStopped(2) {
    // Read auction data
    address positionAddress = sales[id].positionAddress;
    uint96 auctionStartBlock = sales[id].auctionStartBlock;
    uint256 startingPrice = sales[id].startingPrice;

    require(positionAddress != address(0), "CollateralAuctioneer/not-running-auction");

    // Check that auction needs reset
    // and compute current price [ray]
    (bool done, ) = status(auctionStartBlock, startingPrice);
    require(done, "CollateralAuctioneer/cannot-reset");

    uint256 debt = sales[id].debt;
    uint256 collateralAmount = sales[id].collateralAmount;
    sales[id].auctionStartBlock = uint96(block.timestamp);

    uint256 feedPrice = getFeedPrice();
    startingPrice = rmul(feedPrice, startingPriceBuffer);
    require(startingPrice > 0, "CollateralAuctioneer/zero-starting-price");
    sales[id].startingPrice = startingPrice;

    // incentive to redo auction
    uint256 _liquidatorTip = liquidatorTip;
    uint256 _liquidatorBountyRate = liquidatorBountyRate;
    uint256 prize;
    if (_liquidatorTip > 0 || _liquidatorBountyRate > 0) {
      uint256 _minimumRemainingDebt = minimumRemainingDebt;
      if (debt >= _minimumRemainingDebt && mul(collateralAmount, feedPrice) >= _minimumRemainingDebt) {
        prize = add(_liquidatorTip, wmul(debt, _liquidatorBountyRate));
        bookKeeper.mintUnbackedStablecoin(systemDebtEngine, liquidatorAddress, prize);
      }
    }

    emit Redo(id, startingPrice, debt, collateralAmount, positionAddress, liquidatorAddress, prize);
  }

  // Buy up to `collateralAmountToBuy` of collateral from the auction indexed by `id`.
  //
  // Auctions will not collect more DAI than their assigned DAI target,`debt`;
  // thus, if `collateralAmountToBuy` would cost more DAI than `debt` at the current price, the
  // amount of collateral purchased will instead be just enough to collect `debt` DAI.
  //
  // To avoid partial purchases resulting in very small leftover auctions that will
  // never be cleared, any partial purchase must leave at least `CollateralAuctioneer.minimumRemainingDebt`
  // remaining DAI target. `minimumRemainingDebt` is an asynchronously updated value equal to
  // (BookKeeper.debtFloor * Dog.liquidationPenalty(collateralPoolId) / WAD) where the values are understood to be determined
  // by whatever they were when CollateralAuctioneer.updateMinimumRemainingDebt() was last called. Purchase amounts
  // will be minimally decreased when necessary to respect this limit; i.e., if the
  // specified `collateralAmountToBuy` would leave `debt < minimumRemainingDebt` but `debt > 0`, the amount actually
  // purchased will be such that `debt == minimumRemainingDebt`.
  //
  // If `debt <= minimumRemainingDebt`, partial purchases are no longer possible; that is, the remaining
  // collateral can only be purchased entirely, or not at all.
  function take(
    uint256 id, // Auction id
    uint256 collateralAmountToBuy, // Upper limit on amount of collateral to buy  [wad]
    uint256 maxPrice, // Maximum acceptable price (DAI / collateral) [ray]
    address collateralRecipient, // Receiver of collateral and external call address
    bytes calldata data // Data to pass in external call; if length 0, no call is done
  ) external lock isStopped(3) {
    address positionAddress = sales[id].positionAddress;
    uint96 auctionStartBlock = sales[id].auctionStartBlock;

    require(positionAddress != address(0), "CollateralAuctioneer/not-running-auction");

    uint256 price;
    {
      bool done;
      (done, price) = status(auctionStartBlock, sales[id].startingPrice);

      // Check that auction doesn't need reset
      require(!done, "CollateralAuctioneer/needs-reset");
    }

    // Ensure price is acceptable to buyer
    require(maxPrice >= price, "CollateralAuctioneer/too-expensive");

    uint256 collateralAmount = sales[id].collateralAmount;
    uint256 debt = sales[id].debt;
    uint256 owe;

    {
      // Purchase as much as possible, up to collateralAmountToBuy
      uint256 slice = min(collateralAmount, collateralAmountToBuy); // slice <= collateralAmount

      // DAI needed to buy a slice of this sale
      owe = mul(slice, price);

      // Don't collect more than debt of DAI
      if (owe > debt) {
        // Total debt will be paid
        owe = debt; // owe' <= owe
        // Adjust slice
        slice = owe / price; // slice' = owe' / price <= owe / price == slice <= collateralAmount
      } else if (owe < debt && slice < collateralAmount) {
        // If slice == collateralAmount => auction completed => debtFloor doesn't matter
        uint256 _minimumRemainingDebt = minimumRemainingDebt;
        if (debt - owe < _minimumRemainingDebt) {
          // safe as owe < debt
          // If debt <= minimumRemainingDebt, buyers have to take the entire collateralAmount.
          require(debt > _minimumRemainingDebt, "CollateralAuctioneer/no-partial-purchase");
          // Adjust amount to pay
          owe = debt - _minimumRemainingDebt; // owe' <= owe
          // Adjust slice
          slice = owe / price; // slice' = owe' / price < owe / price == slice < collateralAmount
        }
      }

      // Calculate remaining debt after operation
      debt = debt - owe; // safe since owe <= debt
      // Calculate remaining collateralAmount after operation
      collateralAmount = collateralAmount - slice;

      // Send collateral to collateralRecipient
      bookKeeper.moveCollateral(collateralPoolId, address(this), collateralRecipient, slice);
      // Handle Farmable Token
      // Distribute the confisacted rewards and staked collateral to the bidder
      farmableTokenAdapter.moveRewards(address(this), collateralRecipient, slice, abi.encode(0));

      // Do external call (if data is defined) but to be
      // extremely careful we don't allow to do it to the two
      // contracts which the CollateralAuctioneer needs to be authorized
      ILiquidationEngine liquidationEngine_ = liquidationEngine;
      if (
        data.length > 0 &&
        collateralRecipient != address(bookKeeper) &&
        collateralRecipient != address(liquidationEngine_)
      ) {
        IFlashLendingCallee(collateralRecipient).flashLendingCall(msg.sender, owe, slice, data);
      }

      // Get DAI from caller
      bookKeeper.moveStablecoin(msg.sender, systemDebtEngine, owe);

      // Removes Dai out for liquidation from accumulator
      liquidationEngine_.removeRepaidDebtFromAuction(collateralPoolId, collateralAmount == 0 ? debt + owe : owe);
    }

    if (collateralAmount == 0) {
      _remove(id);
    } else if (debt == 0) {
      bookKeeper.moveCollateral(collateralPoolId, address(this), positionAddress, collateralAmount);
      // Return the remaining confiscated rewards and staked collateral to the original position
      farmableTokenAdapter.moveRewards(address(this), positionAddress, collateralAmount, abi.encode(0));
      _remove(id);
    } else {
      sales[id].debt = debt;
      sales[id].collateralAmount = collateralAmount;
    }

    emit Take(id, maxPrice, price, owe, debt, collateralAmount, positionAddress);
  }

  function _remove(uint256 id) internal {
    uint256 _move = active[active.length - 1];
    if (id != _move) {
      uint256 _index = sales[id].pos;
      active[_index] = _move;
      sales[_move].pos = _index;
    }
    active.pop();
    delete sales[id];
  }

  // The number of active auctions
  function count() external view returns (uint256) {
    return active.length;
  }

  // Return the entire array of active auctions
  function list() external view returns (uint256[] memory) {
    return active;
  }

  // Externally returns boolean for if an auction needs a redo and also the current price
  function getStatus(uint256 id)
    external
    view
    returns (
      bool needsRedo,
      uint256 price,
      uint256 collateralAmount,
      uint256 debt
    )
  {
    // Read auction data
    address positionAddress = sales[id].positionAddress;
    uint96 auctionStartBlock = sales[id].auctionStartBlock;

    bool done;
    (done, price) = status(auctionStartBlock, sales[id].startingPrice);

    needsRedo = positionAddress != address(0) && done;
    collateralAmount = sales[id].collateralAmount;
    debt = sales[id].debt;
  }

  // Internally returns boolean for if an auction needs a redo
  function status(uint96 auctionStartBlock, uint256 startingPrice) internal view returns (bool done, uint256 price) {
    price = calc.price(startingPrice, sub(block.timestamp, auctionStartBlock));
    done = (sub(block.timestamp, auctionStartBlock) > auctionTimeLimit ||
      rdiv(price, startingPrice) < priceDropBeforeReset);
  }

  // Public function to update the cached debtFloor*liquidationPenalty value.
  function updateMinimumRemainingDebt() external nonReentrant {
    (, , , , uint256 _debtFloor) = IBookKeeper(bookKeeper).collateralPools(collateralPoolId);
    minimumRemainingDebt = wmul(_debtFloor, liquidationEngine.liquidationPenalty(collateralPoolId));
  }

  // Cancel an auction during Emergency Shutdown or via governance action.
  function yank(uint256 id) external override auth lock {
    require(sales[id].positionAddress != address(0), "CollateralAuctioneer/not-running-auction");
    liquidationEngine.removeRepaidDebtFromAuction(collateralPoolId, sales[id].debt);
    bookKeeper.moveCollateral(collateralPoolId, address(this), msg.sender, sales[id].collateralAmount);
    _remove(id);
    emit Yank(id);
  }
}
