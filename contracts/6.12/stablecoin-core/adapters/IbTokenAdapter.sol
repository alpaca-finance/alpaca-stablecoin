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
import "../../interfaces/IFairLaunch.sol";
import "../../interfaces/ITimeLock.sol";
import "../../interfaces/IShield.sol";
import "../../utils/SafeToken.sol";

import "./FarmableTokenAdapter.sol";

/// @title IbTokenAdapter
/// @author Alpaca Fin Corporation
/** @notice An implementation of `FarmableCollateralAdapter` which accepts ibToken of Alpaca Finance's Leveraged Yield Farming as collateral.
    The ibTokens will be staked on behalf of users into the Alpaca Finance's staking pool to generate yield during the deposit of collateral.
    The ALPACA rewards from the staking pool will be distributed to the collateral owner accordingly.
*/
contract IbTokenAdapter is
  OwnableUpgradeable,
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  FarmableTokenAdapter
{
  using SafeToken for address;

  IFairLaunch public fairlaunch;
  IShield public shield;
  ITimeLock public timelock;
  uint256 public pid;

  // --- Events ---
  event File(bytes32 indexed what, address data);

  /**
        @param _bookKeeper                 MCD_VAT DSS core accounting module
        @param collateralPoolId_                 Collateral type
        @param collateralToken_                 The collateral LP token address
        @param rewardToken_               The SUSHI token contract address.
        @param fairlaunch_          The SushiSwap MCV2 contract address.
        @param pid_                 The index of the sushi pool.
        @param shield_            The expected value of the migration field.
        @param timelock_            The expected value of the owner field. Also needs to be an instance of Timelock.
    */
  function initialize(
    address _bookKeeper,
    bytes32 collateralPoolId_,
    address collateralToken_,
    address rewardToken_,
    address fairlaunch_,
    uint256 pid_,
    address shield_,
    address timelock_
  ) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
    FarmableTokenAdapter.__FarmableTokenAdapter_init(_bookKeeper, collateralPoolId_, collateralToken_, rewardToken_);

    // Sanity checks
    (address lpToken, uint256 allocPoint, , , ) = IFairLaunch(fairlaunch_).poolInfo(pid_);
    require(lpToken == collateralToken_, "IbTokenAdapter/pid-does-not-match-collateralToken");
    require(IFairLaunch(fairlaunch_).alpaca() == rewardToken_, "IbTokenAdapter/rewardToken-does-not-match-sushi");
    require(allocPoint > 0, "IbTokenAdapter/pool-not-active");
    require(IFairLaunch(fairlaunch_).owner() == shield_, "IbTokenAdapter/shield-mismatch");
    require(IShield(shield_).owner() == timelock_, "IbTokenAdapter/owner-mismatch");

    fairlaunch = IFairLaunch(fairlaunch_);
    shield = IShield(shield_);
    timelock = ITimeLock(timelock_);
    pid = pid_;
  }

  /// @dev Invoke the spending allowance execution between this contract and the staking pool contract
  function initApproval() public {
    address(collateralToken).safeApprove(address(fairlaunch), type(uint256).max);
  }

  /// @dev Return the net asset value of this adapter which will be equal to the amount of collateral token deposited in this adapter
  function nav() public view override returns (uint256) {
    return totalShare;
  }

  /// @dev Return the token amount of the harvested reward
  function harvestedRewards() internal override returns (uint256) {
    if (live == 1) {
      // withdraw of 0 will give us only the rewards
      fairlaunch.withdraw(address(this), pid, 0);
    }
    return super.harvestedRewards();
  }

  /// @dev Deposit token into the system from the caller to be used as collateral
  /// @param positionAddress The position address
  /// @param usr The source address which is holding the collateral token
  /// @param val The amount of collateral to be deposited [wad]
  function deposit(
    address positionAddress,
    address usr,
    uint256 val
  ) public override nonReentrant {
    super.deposit(positionAddress, usr, val);
    fairlaunch.deposit(address(this), pid, val);
  }

  /// @dev Withdraw token from the system to the caller
  /// @param urn The position address
  /// @param usr The destination address to receive collateral token
  /// @param val The amount of collateral to be withdrawn [wad]
  function withdraw(
    address urn,
    address usr,
    uint256 val
  ) public override nonReentrant {
    if (live == 1) {
      fairlaunch.withdraw(address(this), pid, val);
    }
    super.withdraw(urn, usr, val);
  }

  /// @dev Withdraw the collateral token without caring about rewards in case something wrong happen with the rewads
  /// @param urn The position address
  /// @param usr The destination address to receive collateral token
  function emergencyWithdraw(address urn, address usr) public override nonReentrant {
    if (live == 1) {
      uint256 val = bookKeeper.collateralToken(collateralPoolId, urn);
      fairlaunch.withdraw(address(this), pid, val);
    }
    super.emergencyWithdraw(urn, usr);
  }

  function cage() public override nonReentrant {
    require(live == 1, "IbTokenAdapter/not-live");

    // Allow caging if any assumptions change
    require(
      whitelist[msg.sender] == 1 || fairlaunch.owner() != address(shield) || shield.owner() != address(timelock),
      "IbTokenAdapter/not-authorized"
    );

    _cage();
  }

  function _cage() internal {
    fairlaunch.emergencyWithdraw(pid);
    live = 0;
  }

  function uncage() external auth {
    fairlaunch.deposit(address(this), pid, totalShare);
    live = 1;
  }
}
