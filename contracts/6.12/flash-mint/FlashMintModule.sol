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

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IERC3156FlashLender.sol";
import "../interfaces/IERC3156FlashBorrower.sol";
import "../interfaces/IBookKeeperFlashLender.sol";
import "../interfaces/IStablecoin.sol";
import "../interfaces/IStablecoinAdapter.sol";
import "../interfaces/IBookKeeper.sol";

contract FlashMintModule is PausableUpgradeable, IERC3156FlashLender, IBookKeeperFlashLender {
  modifier onlyOwner() {
    IAccessControlConfig _accessControlConfig = IAccessControlConfig(bookKeeper.accessControlConfig());
    require(_accessControlConfig.hasRole(_accessControlConfig.OWNER_ROLE(), msg.sender), "!ownerRole");
    _;
  }

  // --- Data ---
  IBookKeeper public bookKeeper;
  IStablecoinAdapter public stablecoinAdapter;
  IStablecoin public stablecoin;
  address public systemDebtEngine; // systemDebtEngine intentionally set immutable to save gas

  uint256 public max; // Maximum borrowable stablecoin  [wad]
  uint256 public feeRate; // Fee                     [wad = 100%]
  uint256 private locked; // Reentrancy guard

  bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");
  bytes32 public constant CALLBACK_SUCCESS_BOOK_KEEPER_STABLE_COIN =
    keccak256("BookKeeperFlashBorrower.onBookKeeperFlashLoan");

  // --- Events ---
  event SetMax(uint256 _data);
  event SetFeeRate(uint256 _data);
  event FlashLoan(address indexed _receiver, address _token, uint256 _amount, uint256 _fee);
  event BookKeeperFlashLoan(address indexed _receiver, uint256 _amount, uint256 _fee);

  modifier lock() {
    require(locked == 0, "FlashMintModule/reentrancy-guard");
    locked = 1;
    _;
    locked = 0;
  }

  // --- Init ---
  function initialize(address _stablecoinAdapter, address _systemDebtEngine) external initializer {
    // 1. Initialized all dependencies
    PausableUpgradeable.__Pausable_init();

    bookKeeper = IBookKeeper(IStablecoinAdapter(_stablecoinAdapter).bookKeeper());
    stablecoinAdapter = IStablecoinAdapter(_stablecoinAdapter);
    stablecoin = IStablecoin(IStablecoinAdapter(_stablecoinAdapter).stablecoin());
    systemDebtEngine = _systemDebtEngine;

    bookKeeper.whitelist(_stablecoinAdapter);
    stablecoin.approve(_stablecoinAdapter, type(uint256).max);
  }

  // --- Math ---
  uint256 constant WAD = 10**18;
  uint256 constant RAY = 10**27;
  uint256 constant RAD = 10**45;

  function _add(uint256 _x, uint256 _y) internal pure returns (uint256 z) {
    require((z = _x + _y) >= _x);
  }

  function _mul(uint256 _x, uint256 _y) internal pure returns (uint256 z) {
    require(_y == 0 || (z = _x * _y) / _y == _x);
  }

  // --- Administration ---
  function setMax(uint256 _data) external onlyOwner {
    // Add an upper limit of 10^27 Stablecoin to avoid breaking technical assumptions of Stablecoin << 2^256 - 1
    require((max = _data) <= RAD, "FlashMintModule/ceiling-too-high");
    emit SetMax(_data);
  }

  function setFeeRate(uint256 _data) external onlyOwner {
    feeRate = _data;
    emit SetFeeRate(_data);
  }

  // --- ERC 3156 Spec ---
  function maxFlashLoan(address _token) external view override returns (uint256) {
    if (_token == address(stablecoin) && locked == 0) {
      return max;
    } else {
      return 0;
    }
  }

  function flashFee(address _token, uint256 _amount) external view override returns (uint256) {
    require(_token == address(stablecoin), "FlashMintModule/token-unsupported");

    return _mul(_amount, feeRate) / WAD;
  }

  function flashLoan(
    IERC3156FlashBorrower _receiver,
    address _token,
    uint256 _amount,
    bytes calldata _data
  ) external override lock returns (bool) {
    require(_token == address(stablecoin), "FlashMintModule/token-unsupported");
    require(_amount <= max, "FlashMintModule/ceiling-exceeded");

    uint256 _amt = _mul(_amount, RAY);
    uint256 _fee = _mul(_amount, feeRate) / WAD;
    uint256 _total = _add(_amount, _fee);

    bookKeeper.mintUnbackedStablecoin(address(this), address(this), _amt);
    stablecoinAdapter.withdraw(address(_receiver), _amount, abi.encode(0));

    emit FlashLoan(address(_receiver), _token, _amount, _fee);

    require(
      _receiver.onFlashLoan(msg.sender, _token, _amount, _fee, _data) == CALLBACK_SUCCESS,
      "FlashMintModule/callback-failed"
    );

    stablecoin.transferFrom(address(_receiver), address(this), _total); // The fee is also enforced here
    stablecoinAdapter.deposit(address(this), _total, abi.encode(0));
    bookKeeper.settleSystemBadDebt(_amt);

    return true;
  }

  // --- BookKeeper Flash Loan ---
  function bookKeeperFlashLoan(
    IBookKeeperFlashBorrower _receiver, // address of conformant IBookKeeperFlashBorrower
    uint256 _amount, // amount to flash loan [rad]
    bytes calldata _data // arbitrary data to pass to the receiver
  ) external override lock returns (bool) {
    require(_amount <= _mul(max, RAY), "FlashMintModule/ceiling-exceeded");

    uint256 _prev = bookKeeper.stablecoin(address(this));
    uint256 _fee = _mul(_amount, feeRate) / WAD;

    bookKeeper.mintUnbackedStablecoin(address(this), address(_receiver), _amount);

    emit BookKeeperFlashLoan(address(_receiver), _amount, _fee);

    require(
      _receiver.onBookKeeperFlashLoan(msg.sender, _amount, _fee, _data) == CALLBACK_SUCCESS_BOOK_KEEPER_STABLE_COIN,
      "FlashMintModule/callback-failed"
    );

    bookKeeper.settleSystemBadDebt(_amount);
    require(bookKeeper.stablecoin(address(this)) >= _add(_prev, _fee), "FlashMintModule/insufficient-fee");

    return true;
  }

  function convert() external lock {
    stablecoinAdapter.deposit(address(this), stablecoin.balanceOf(address(this)), abi.encode(0));
  }

  function accrue() external lock {
    bookKeeper.moveStablecoin(address(this), systemDebtEngine, bookKeeper.stablecoin(address(this)));
  }
}
