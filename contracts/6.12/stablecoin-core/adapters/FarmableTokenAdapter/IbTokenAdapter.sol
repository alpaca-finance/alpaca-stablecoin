// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "../../../interfaces/IFairLaunch.sol";
import "../../../interfaces/ITimeLock.sol";
import "../../../interfaces/IShield.sol";
import "../../../utils/SafeToken.sol";

import "./BaseFarmableTokenAdapter.sol";

/// @title IbTokenAdapter is the adapter that inherited BaseFarmableTokenAdapter.
/// It receives Alpaca's ibTOKEN from users and deposit in Alpaca's FairLaunch.
/// Hence, users will still earn ALPACA rewards while holding positions.
contract IbTokenAdapter is
  OwnableUpgradeable,
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  BaseFarmableTokenAdapter
{
  using SafeToken for address;

  /// @dev The Alpaca's Fairlaunch contract
  IFairLaunch public fairlaunch;
  /// @dev The Alpaca's Shield contract
  IShield public shield;
  /// @dev The Timelock that owns Shield
  ITimeLock public timelock;
  /// @dev The pool id that this ibTokenAdapter is working with
  uint256 public pid;

  /// @dev Events
  event File(bytes32 indexed what, address data);

  function initialize(
    address _bookKeeper,
    bytes32 _collateralPoolId,
    address _collateralToken,
    address _rewardToken,
    address _fairlaunch,
    uint256 _pid,
    address _shield,
    address _timelock
  ) external initializer {
    // 1. Initialized all dependencies
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
    BaseFarmableTokenAdapter.__FarmableTokenAdapter_init(
      _bookKeeper,
      _collateralPoolId,
      _collateralToken,
      _rewardToken
    );

    // 2. Sanity checks
    (address lpToken, uint256 allocPoint, , , ) = IFairLaunch(_fairlaunch).poolInfo(_pid);
    require(lpToken == _collateralToken, "IbTokenAdapter/pid-does-not-match-collateralToken");
    require(IFairLaunch(_fairlaunch).alpaca() == _rewardToken, "IbTokenAdapter/rewardToken-does-not-match-sushi");
    require(allocPoint > 0, "IbTokenAdapter/pool-not-active");
    require(IFairLaunch(_fairlaunch).owner() == _shield, "IbTokenAdapter/shield-mismatch");
    require(IShield(_shield).owner() == _timelock, "IbTokenAdapter/owner-mismatch");

    fairlaunch = IFairLaunch(_fairlaunch);
    shield = IShield(_shield);
    timelock = ITimeLock(_timelock);
    pid = _pid;

    address(collateralToken).safeApprove(address(fairlaunch), uint256(-1));
  }

  /// @dev Ignore collateralTokens that have been directly transferred
  function netAssetValuation() public view override returns (uint256) {
    return totalShare;
  }

  /// @dev Harvest ALPACA from FairLaunch
  function _harvest() internal override returns (uint256) {
    if (live == 1) {
      // Withdraw all rewards
      fairlaunch.withdraw(address(this), pid, 0);
    }
    return super._harvest();
  }

  /// @dev Harvest and deposit received ibToken to FairLaunch
  /// @param positionAddress The address that holding states of the position
  /// @param val The ibToken amount that being used as a collateral and to be deposited to FairLaunch
  /// @param data The extra data that may needs to execute the deposit
  function deposit(
    address positionAddress,
    uint256 val,
    bytes calldata data
  ) public payable override nonReentrant {
    super.deposit(positionAddress, val, data);
    fairlaunch.deposit(address(this), pid, val);
  }

  /// @dev Harvest and withdraw ibToken from FairLaunch
  /// @param positionAddress The address that holding states of the position
  /// @param val The ibToken amount to be withdrawn from FairLaunch and return to user
  /// @param data The extra data that may needs to execute the withdraw
  function withdraw(
    address positionAddress,
    uint256 val,
    bytes calldata data
  ) public override nonReentrant {
    if (live == 1) {
      fairlaunch.withdraw(address(this), pid, val);
    }
    super.withdraw(positionAddress, val, data);
  }

  /// @dev EMERGENCY ONLY. Withdraw ibToken from FairLaunch with invoking "_harvest"
  function emergencyWithdraw(address positionAddress, address user) public override nonReentrant {
    if (live == 1) {
      uint256 val = bookKeeper.collateralToken(collateralPoolId, positionAddress);
      fairlaunch.withdraw(address(this), pid, val);
    }
    super.emergencyWithdraw(positionAddress, user);
  }

  /// @dev Pause ibTokenAdapter when assumptions change
  function cage() public override nonReentrant {
    require(live == 1, "IbTokenAdapter/not-live");

    // Allow caging if
    // - msg.sender is whitelisted to do so
    // - FairLaunch's owner has been changed
    // - Shield's owner has been changed
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
