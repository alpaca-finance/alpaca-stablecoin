// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021 Dai Foundation
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

import "../interfaces/IStablecoinAdapter.sol";
import "../interfaces/IStablecoin.sol";
import "../interfaces/IBookKeeper.sol";
import "../interfaces/IAuthTokenAdapter.sol";
import "../interfaces/IStableSwapModule.sol";

// Stable Swap Module
// Allows anyone to go between AUSD and the Token by pooling the liquidity
// An optional fee is charged for incoming and outgoing transfers

contract StableSwapModule is OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable, IStableSwapModule {
  // --- Auth ---
  mapping(address => uint256) public whitelist;

  function rely(address usr) external auth {
    whitelist[usr] = 1;
    emit Rely(usr);
  }

  function deny(address usr) external auth {
    whitelist[usr] = 0;
    emit Deny(usr);
  }

  modifier auth() {
    require(whitelist[msg.sender] == 1);
    _;
  }

  IBookKeeper public bookKeeper;
  IAuthTokenAdapter public override authTokenAdapter;
  IStablecoin public stablecoin;
  IStablecoinAdapter public override stablecoinAdapter;
  bytes32 public collateralPoolId;
  address public systemDebtEngine;

  uint256 internal to18ConversionFactor;

  uint256 public feeIn; // fee in [wad]
  uint256 public feeOut; // fee out [wad]

  // --- Events ---
  event Rely(address indexed usr);
  event Deny(address indexed usr);
  event File(bytes32 indexed what, uint256 data);
  event SellToken(address indexed owner, uint256 value, uint256 fee);
  event BuyToken(address indexed owner, uint256 value, uint256 fee);

  // --- Init ---
  function initialize(
    address authTokenAdapter_,
    address stablecoinAdapter_,
    address systemDebtEngine_
  ) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    whitelist[msg.sender] = 1;
    emit Rely(msg.sender);
    IAuthTokenAdapter authTokenAdapter__ = authTokenAdapter = IAuthTokenAdapter(authTokenAdapter_);
    IStablecoinAdapter stablecoinAdapter__ = stablecoinAdapter = IStablecoinAdapter(stablecoinAdapter_);
    IBookKeeper bookKeeper__ = bookKeeper = IBookKeeper(address(authTokenAdapter__.bookKeeper()));
    IStablecoin stablecoin__ = stablecoin = IStablecoin(address(stablecoinAdapter__.stablecoin()));
    collateralPoolId = authTokenAdapter__.collateralPoolId();
    systemDebtEngine = systemDebtEngine_;
    to18ConversionFactor = 10**(18 - authTokenAdapter__.decimals());
    stablecoin__.approve(stablecoinAdapter_, uint256(-1));
    bookKeeper__.whitelist(stablecoinAdapter_);
  }

  // --- Math ---
  uint256 constant WAD = 10**18;
  uint256 constant RAY = 10**27;

  function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x + y) >= x);
  }

  function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x - y) <= x);
  }

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x);
  }

  // --- Administration ---
  function file(bytes32 what, uint256 data) external auth {
    if (what == "feeIn") feeIn = data;
    else if (what == "feeOut") feeOut = data;
    else revert("PegStabilityModule/file-unrecognized-param");

    emit File(what, data);
  }

  // hope can be used to transfer control of the PSM vault to another contract
  // This can be used to upgrade the contract
  function hope(address usr) external auth {
    bookKeeper.whitelist(usr);
  }

  function nope(address usr) external auth {
    bookKeeper.blacklist(usr);
  }

  // --- Primary Functions ---
  /**
   * @dev Deposit token into the system and withdraw to receive stablecoin
   * @param usr The address of the account to sell
   * @param tokenAmount The Amount of token to sell
   */
  function swapTokenForStablecoin(address usr, uint256 tokenAmount) external override {
    uint256 tokenAmount18 = mul(tokenAmount, to18ConversionFactor);
    uint256 fee = mul(tokenAmount18, feeIn) / WAD;
    uint256 stablecoinAmount = sub(tokenAmount18, fee);
    authTokenAdapter.deposit(address(this), tokenAmount, msg.sender);
    bookKeeper.adjustPosition(
      collateralPoolId,
      address(this),
      address(this),
      address(this),
      int256(tokenAmount18),
      int256(tokenAmount18)
    );
    bookKeeper.moveStablecoin(address(this), systemDebtEngine, mul(fee, RAY));
    stablecoinAdapter.withdraw(usr, stablecoinAmount, abi.encode(0));

    emit SellToken(usr, tokenAmount, fee);
  }

  /**
   * @dev Deposit stablecoin into the system and withdraw to receive token
   * @param usr The address of the account to buy
   * @param tokenAmount The Amount of token to buy
   */
  function swapStablecoinToToken(address usr, uint256 tokenAmount) external override {
    uint256 tokenAmount18 = mul(tokenAmount, to18ConversionFactor);
    uint256 fee = mul(tokenAmount18, feeOut) / WAD;
    uint256 stablecoinAmount = add(tokenAmount18, fee);
    require(stablecoin.transferFrom(msg.sender, address(this), stablecoinAmount), "PegStabilityModule/failed-transfer");
    stablecoinAdapter.deposit(address(this), stablecoinAmount, abi.encode(0));
    bookKeeper.adjustPosition(
      collateralPoolId,
      address(this),
      address(this),
      address(this),
      -int256(tokenAmount18),
      -int256(tokenAmount18)
    );
    authTokenAdapter.withdraw(usr, tokenAmount);
    bookKeeper.moveStablecoin(address(this), systemDebtEngine, mul(fee, RAY));

    emit BuyToken(usr, tokenAmount, fee);
  }
}
