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

/// @title IbTokenAdapter is tha adapter that inherited BaseFarmableTokenAdapter.
/// It receives Alpaca's ibTOKEN from users and deposit in Alpaca's FairLaunch.
/// Hence, users will still earn ALPACA rewards while holding a position
contract IbTokenAdapter is
  OwnableUpgradeable,
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  BaseFarmableTokenAdapter
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
    BaseFarmableTokenAdapter.__FarmableTokenAdapter_init(
      _bookKeeper,
      collateralPoolId_,
      collateralToken_,
      rewardToken_
    );

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

  function initApproval() public {
    address(collateralToken).safeApprove(address(fairlaunch), type(uint256).max);
  }

  // Ignore collateralTokens that have been directly transferred
  function nav() public view override returns (uint256) {
    return totalShare;
  }

  function harvestedRewards() internal override returns (uint256) {
    if (live == 1) {
      // withdraw of 0 will give us only the rewards
      fairlaunch.withdraw(address(this), pid, 0);
    }
    return super.harvestedRewards();
  }

  function deposit(
    address positionAddress,
    uint256 val,
    bytes calldata data
  ) public payable override nonReentrant {
    super.deposit(positionAddress, val, data);
    fairlaunch.deposit(address(this), pid, val);
  }

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
