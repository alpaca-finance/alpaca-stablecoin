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

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "../../interfaces/IBookKeeper.sol";

// receives tokens and shares them among holders
contract FarmableTokenAdapter is Initializable {
  mapping(address => uint256) whitelist;
  uint256 live;

  IBookKeeper public bookKeeper; // cdp engine
  bytes32 public collateralPoolId; // collateral type
  ERC20Upgradeable public collateralToken; // collateral token
  uint256 public decimals; // collateralToken decimals
  ERC20Upgradeable public rewardToken; // rewhitelist token

  uint256 public accRewardPerShare; // rewards per collateralToken    [ray]
  uint256 public totalShare; // total collateralTokens       [wad]
  uint256 public accRewardBalance; // crop balance     [wad]

  mapping(address => uint256) public rewardDebts; // rewardDebt per user  [wad]
  mapping(address => uint256) public stake; // collateralTokens per user   [wad]

  uint256 internal to18ConversionFactor;
  uint256 internal toTokenConversionFactor;

  // --- Events ---
  event Deposit(uint256 val);
  event Withdraw(uint256 val);
  event Flee();
  event MoveRewards(address indexed src, address indexed dst, uint256 wad);
  event Rely(address indexed usr);
  event Deny(address indexed usr);

  modifier auth {
    require(whitelist[msg.sender] == 1, "FarmableToken/not-authed");
    _;
  }

  function rely(address usr) external auth {
    whitelist[usr] = 1;
    emit Rely(msg.sender);
  }

  function deny(address usr) external auth {
    whitelist[usr] = 0;
    emit Deny(msg.sender);
  }

  function __FarmableTokenAdapter_init(
    address _bookKeeper,
    bytes32 collateralPoolId_,
    address collateralToken_,
    address rewardToken_
  ) internal initializer {
    __FarmableTokenAdapter_init_unchained(_bookKeeper, collateralPoolId_, collateralToken_, rewardToken_);
  }

  function __FarmableTokenAdapter_init_unchained(
    address _bookKeeper,
    bytes32 collateralPoolId_,
    address collateralToken_,
    address rewardToken_
  ) internal initializer {
    whitelist[msg.sender] = 1;
    emit Rely(msg.sender);
    live = 1;
    bookKeeper = IBookKeeper(_bookKeeper);
    collateralPoolId = collateralPoolId_;
    collateralToken = ERC20Upgradeable(collateralToken_);
    uint256 decimals_ = ERC20Upgradeable(collateralToken_).decimals();
    require(decimals_ <= 18);
    decimals = decimals_;
    to18ConversionFactor = 10**(18 - decimals_);
    toTokenConversionFactor = 10**decimals_;
    rewardToken = ERC20Upgradeable(rewardToken_);
  }

  function add(uint256 x, uint256 y) public pure returns (uint256 z) {
    require((z = x + y) >= x, "ds-math-add-overflow");
  }

  function sub(uint256 x, uint256 y) public pure returns (uint256 z) {
    require((z = x - y) <= x, "ds-math-sub-underflow");
  }

  function mul(uint256 x, uint256 y) public pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x, "ds-math-mul-overflow");
  }

  function divup(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = add(x, sub(y, 1)) / y;
  }

  uint256 constant WAD = 10**18;

  function wmul(uint256 x, uint256 y) public pure returns (uint256 z) {
    z = mul(x, y) / WAD;
  }

  function wdiv(uint256 x, uint256 y) public pure returns (uint256 z) {
    z = mul(x, WAD) / y;
  }

  function wdivup(uint256 x, uint256 y) public pure returns (uint256 z) {
    z = divup(mul(x, WAD), y);
  }

  uint256 constant RAY = 10**27;

  function rmul(uint256 x, uint256 y) public pure returns (uint256 z) {
    z = mul(x, y) / RAY;
  }

  function rmulup(uint256 x, uint256 y) public pure returns (uint256 z) {
    z = divup(mul(x, y), RAY);
  }

  function rdiv(uint256 x, uint256 y) public pure returns (uint256 z) {
    z = mul(x, RAY) / y;
  }

  // Net Asset Valuation [wad]
  function nav() public view virtual returns (uint256) {
    uint256 _nav = collateralToken.balanceOf(address(this));
    return mul(_nav, to18ConversionFactor);
  }

  // Net Assets per Share [wad]
  function nps() public view returns (uint256) {
    if (totalShare == 0) return WAD;
    else return wdiv(nav(), totalShare);
  }

  function harvestedRewards() internal virtual returns (uint256) {
    return sub(rewardToken.balanceOf(address(this)), accRewardBalance);
  }

  function harvest(address from, address to) internal {
    if (totalShare > 0) accRewardPerShare = add(accRewardPerShare, rdiv(harvestedRewards(), totalShare));

    uint256 last = rewardDebts[from];
    uint256 curr = rmul(stake[from], accRewardPerShare);
    if (curr > last) require(rewardToken.transfer(to, curr - last));
    accRewardBalance = rewardToken.balanceOf(address(this));
  }

  function deposit(
    address positionAddress,
    address usr,
    uint256 val
  ) public virtual {
    require(live == 1, "FarmableToken/not-live");

    harvest(positionAddress, usr);
    if (val > 0) {
      uint256 wad = wdiv(mul(val, to18ConversionFactor), nps());

      // Overflow check for int256(wad) cast below
      // Also enforces a non-zero wad
      require(int256(wad) > 0);

      require(collateralToken.transferFrom(msg.sender, address(this), val));
      bookKeeper.addCollateral(collateralPoolId, positionAddress, int256(wad));

      totalShare = add(totalShare, wad);
      stake[positionAddress] = add(stake[positionAddress], wad);
    }
    rewardDebts[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);
    emit Deposit(val);
  }

  function withdraw(
    address positionAddress,
    address usr,
    uint256 val
  ) public virtual {
    harvest(positionAddress, usr);
    if (val > 0) {
      uint256 wad = wdivup(mul(val, to18ConversionFactor), nps());

      // Overflow check for int256(wad) cast below
      // Also enforces a non-zero wad
      require(int256(wad) > 0);

      require(collateralToken.transfer(usr, val));
      bookKeeper.addCollateral(collateralPoolId, positionAddress, -int256(wad));

      totalShare = sub(totalShare, wad);
      stake[positionAddress] = sub(stake[positionAddress], wad);
    }
    rewardDebts[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);
    emit Withdraw(val);
  }

  function emergencyWithdraw(address positionAddress, address usr) public virtual {
    uint256 wad = bookKeeper.collateralToken(collateralPoolId, positionAddress);
    require(wad <= 2**255);
    uint256 val = wmul(wmul(wad, nps()), toTokenConversionFactor);

    require(collateralToken.transfer(usr, val));
    bookKeeper.addCollateral(collateralPoolId, positionAddress, -int256(wad));

    totalShare = sub(totalShare, wad);
    stake[positionAddress] = sub(stake[positionAddress], wad);
    rewardDebts[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);

    emit Flee();
  }

  function moveRewards(
    address src,
    address dst,
    uint256 wad
  ) public {
    uint256 ss = stake[src];
    stake[src] = sub(ss, wad);
    stake[dst] = add(stake[dst], wad);

    uint256 cs = rewardDebts[src];
    uint256 drewardDebt = mul(cs, wad) / ss;

    // safe since drewardDebts <= rewardDebts[src]
    rewardDebts[src] = cs - drewardDebt;
    rewardDebts[dst] = add(rewardDebts[dst], drewardDebt);

    (uint256 lockedCollateral, ) = bookKeeper.positions(collateralPoolId, src);
    require(stake[src] >= add(bookKeeper.collateralToken(collateralPoolId, src), lockedCollateral));
    (lockedCollateral, ) = bookKeeper.positions(collateralPoolId, dst);
    require(stake[dst] <= add(bookKeeper.collateralToken(collateralPoolId, dst), lockedCollateral));

    emit MoveRewards(src, dst, wad);
  }

  function cage() public virtual auth {
    live = 0;
  }
}
