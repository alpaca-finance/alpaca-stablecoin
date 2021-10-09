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

contract FlashMintModule is PausableUpgradeable, AccessControlUpgradeable, IERC3156FlashLender, IBookKeeperFlashLender {
  // --- Auth ---
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;

  modifier onlyOwner() {
    require(
      bookKeeper.accessControlConfig().hasRole(bookKeeper.accessControlConfig().OWNER_ROLE(), msg.sender),
      "!ownerRole"
    );
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
  event SetMax(uint256 data);
  event SetFeeRate(uint256 data);
  event FlashLoan(address indexed receiver, address token, uint256 amount, uint256 fee);
  event BookKeeperFlashLoan(address indexed receiver, uint256 amount, uint256 fee);

  modifier lock() {
    require(locked == 0, "FlashMintModule/reentrancy-guard");
    locked = 1;
    _;
    locked = 0;
  }

  // --- Init ---
  function initialize(address stablecoinAdapter_, address systemDebtEngine_) external initializer {
    // 1. Initialized all dependencies
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    _setupRole(OWNER_ROLE, msg.sender);

    IBookKeeper bookKeeper_ = bookKeeper = IBookKeeper(IStablecoinAdapter(stablecoinAdapter_).bookKeeper());
    stablecoinAdapter = IStablecoinAdapter(stablecoinAdapter_);
    IStablecoin stablecoin_ = stablecoin = IStablecoin(IStablecoinAdapter(stablecoinAdapter_).stablecoin());
    systemDebtEngine = systemDebtEngine_;

    bookKeeper_.whitelist(stablecoinAdapter_);
    stablecoin_.approve(stablecoinAdapter_, type(uint256).max);
  }

  // --- Math ---
  uint256 constant WAD = 10**18;
  uint256 constant RAY = 10**27;
  uint256 constant RAD = 10**45;

  function _add(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x + y) >= x);
  }

  function _mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x);
  }

  // --- Administration ---
  function setMax(uint256 data) external onlyOwner {
    // Add an upper limit of 10^27 Stablecoin to avoid breaking technical assumptions of Stablecoin << 2^256 - 1
    require((max = data) <= RAD, "FlashMintModule/ceiling-too-high");
    emit SetMax(data);
  }

  function setFeeRate(uint256 data) external onlyOwner {
    feeRate = data;
    emit SetFeeRate(data);
  }

  // --- ERC 3156 Spec ---
  function maxFlashLoan(address token) external view override returns (uint256) {
    if (token == address(stablecoin) && locked == 0) {
      return max;
    } else {
      return 0;
    }
  }

  function flashFee(address token, uint256 amount) external view override returns (uint256) {
    require(token == address(stablecoin), "FlashMintModule/token-unsupported");

    return _mul(amount, feeRate) / WAD;
  }

  function flashLoan(
    IERC3156FlashBorrower receiver,
    address token,
    uint256 amount,
    bytes calldata data
  ) external override lock returns (bool) {
    require(token == address(stablecoin), "FlashMintModule/token-unsupported");
    require(amount <= max, "FlashMintModule/ceiling-exceeded");

    uint256 amt = _mul(amount, RAY);
    uint256 fee = _mul(amount, feeRate) / WAD;
    uint256 total = _add(amount, fee);

    bookKeeper.mintUnbackedStablecoin(address(this), address(this), amt);
    stablecoinAdapter.withdraw(address(receiver), amount, abi.encode(0));

    emit FlashLoan(address(receiver), token, amount, fee);

    require(
      receiver.onFlashLoan(msg.sender, token, amount, fee, data) == CALLBACK_SUCCESS,
      "FlashMintModule/callback-failed"
    );

    stablecoin.transferFrom(address(receiver), address(this), total); // The fee is also enforced here
    stablecoinAdapter.deposit(address(this), total, abi.encode(0));
    bookKeeper.settleSystemBadDebt(amt);

    return true;
  }

  // --- BookKeeper Flash Loan ---
  function bookKeeperFlashLoan(
    IBookKeeperFlashBorrower receiver, // address of conformant IBookKeeperFlashBorrower
    uint256 amount, // amount to flash loan [rad]
    bytes calldata data // arbitrary data to pass to the receiver
  ) external override lock returns (bool) {
    require(amount <= _mul(max, RAY), "FlashMintModule/ceiling-exceeded");

    uint256 prev = bookKeeper.stablecoin(address(this));
    uint256 fee = _mul(amount, feeRate) / WAD;

    bookKeeper.mintUnbackedStablecoin(address(this), address(receiver), amount);

    emit BookKeeperFlashLoan(address(receiver), amount, fee);

    require(
      receiver.onBookKeeperFlashLoan(msg.sender, amount, fee, data) == CALLBACK_SUCCESS_BOOK_KEEPER_STABLE_COIN,
      "FlashMintModule/callback-failed"
    );

    bookKeeper.settleSystemBadDebt(amount);
    require(bookKeeper.stablecoin(address(this)) >= _add(prev, fee), "FlashMintModule/insufficient-fee");

    return true;
  }

  function convert() external lock {
    stablecoinAdapter.deposit(address(this), stablecoin.balanceOf(address(this)), abi.encode(0));
  }

  function accrue() external lock {
    bookKeeper.moveStablecoin(address(this), systemDebtEngine, bookKeeper.stablecoin(address(this)));
  }
}
