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
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "../interfaces/IStablecoinAdapter.sol";
import "../interfaces/IStablecoin.sol";
import "../interfaces/IBookKeeper.sol";
import "../interfaces/IAuthTokenAdapter.sol";
import "../interfaces/IStableSwapModule.sol";

// Stable Swap Module
// Allows anyone to go between AUSD and the Token by pooling the liquidity
// An optional fee is charged for incoming and outgoing transfers

contract StableSwapModule is
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  IStableSwapModule
{
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;
  bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");

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
  event SetFeeIn(address indexed _caller, uint256 _feeIn);
  event SetFeeOut(address indexed _caller, uint256 _feeOut);
  event SwapTokenToStablecoin(address indexed owner, uint256 value, uint256 fee);
  event SwapStablecoinToToken(address indexed owner, uint256 value, uint256 fee);

  // --- Init ---
  function initialize(
    address _authTokenAdapter,
    address _stablecoinAdapter,
    address _systemDebtEngine
  ) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    IAuthTokenAdapter __authTokenAdapter = authTokenAdapter = IAuthTokenAdapter(_authTokenAdapter);
    IStablecoinAdapter __stablecoinAdapter = stablecoinAdapter = IStablecoinAdapter(_stablecoinAdapter);
    IBookKeeper _bookKeeper = bookKeeper = IBookKeeper(address(__authTokenAdapter.bookKeeper()));
    IStablecoin _stablecoin = stablecoin = IStablecoin(address(__stablecoinAdapter.stablecoin()));
    collateralPoolId = __authTokenAdapter.collateralPoolId();
    systemDebtEngine = _systemDebtEngine;
    to18ConversionFactor = 10**(18 - __authTokenAdapter.decimals());
    _stablecoin.approve(_stablecoinAdapter, uint256(-1));
    _bookKeeper.whitelist(_stablecoinAdapter);

    // Grant the contract deployer the owner role: it will be able
    // to grant and revoke any roles
    _setupRole(OWNER_ROLE, msg.sender);
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

  function setFeeIn(uint256 _feeIn) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(_feeIn <= 5 * 1e17, "StableSwapModule/invalid-fee-in"); // Max feeIn is 0.5 Ethers or 50%
    feeIn = _feeIn;
    emit SetFeeIn(msg.sender, _feeIn);
  }

  function setFeeOut(uint256 _feeOut) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(_feeOut <= 5 * 1e17, "StableSwapModule/invalid-fee-in"); // Max feeOut is 0.5 Ethers or 50%
    feeOut = _feeOut;
    emit SetFeeOut(msg.sender, _feeOut);
  }

  // hope can be used to transfer control of the PSM vault to another contract
  // This can be used to upgrade the contract
  function whitelist(address _usr) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    bookKeeper.whitelist(_usr);
  }

  function blacklist(address _usr) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    bookKeeper.blacklist(_usr);
  }

  // --- Primary Functions ---
  /**
   * @dev Deposit token into the system and withdraw to receive stablecoin
   * @param _usr The address of the account to sell
   * @param _tokenAmount The Amount of token to sell
   */
  function swapTokenToStablecoin(address _usr, uint256 _tokenAmount) external override nonReentrant whenNotPaused {
    uint256 _tokenAmount18 = mul(_tokenAmount, to18ConversionFactor);
    uint256 _fee = mul(_tokenAmount18, feeIn) / WAD;
    uint256 _stablecoinAmount = sub(_tokenAmount18, _fee);
    authTokenAdapter.deposit(address(this), _tokenAmount, msg.sender);
    bookKeeper.adjustPosition(
      collateralPoolId,
      address(this),
      address(this),
      address(this),
      int256(_tokenAmount18),
      int256(_tokenAmount18)
    );
    bookKeeper.moveStablecoin(address(this), systemDebtEngine, mul(_fee, RAY));
    stablecoinAdapter.withdraw(_usr, _stablecoinAmount, abi.encode(0));

    emit SwapTokenToStablecoin(_usr, _tokenAmount, _fee);
  }

  /**
   * @dev Deposit stablecoin into the system and withdraw to receive token
   * @param _usr The address of the account to buy
   * @param _tokenAmount The Amount of token to buy
   */
  function swapStablecoinToToken(address _usr, uint256 _tokenAmount) external override nonReentrant whenNotPaused {
    uint256 _tokenAmount18 = mul(_tokenAmount, to18ConversionFactor);
    uint256 _fee = mul(_tokenAmount18, feeOut) / WAD;
    uint256 _stablecoinAmount = add(_tokenAmount18, _fee);
    require(stablecoin.transferFrom(msg.sender, address(this), _stablecoinAmount), "StableSwapModule/failed-transfer");
    stablecoinAdapter.deposit(address(this), _stablecoinAmount, abi.encode(0));
    bookKeeper.adjustPosition(
      collateralPoolId,
      address(this),
      address(this),
      address(this),
      -int256(_tokenAmount18),
      -int256(_tokenAmount18)
    );
    authTokenAdapter.withdraw(_usr, _tokenAmount);
    bookKeeper.moveStablecoin(address(this), systemDebtEngine, mul(_fee, RAY));

    emit SwapStablecoinToToken(_usr, _tokenAmount, _fee);
  }

  // --- pause ---
  function pause() external {
    require(hasRole(OWNER_ROLE, msg.sender) || hasRole(GOV_ROLE, msg.sender), "!(ownerRole or govRole)");
    _pause();
  }

  function unpause() external {
    require(hasRole(OWNER_ROLE, msg.sender) || hasRole(GOV_ROLE, msg.sender), "!(ownerRole or govRole)");
    _unpause();
  }
}