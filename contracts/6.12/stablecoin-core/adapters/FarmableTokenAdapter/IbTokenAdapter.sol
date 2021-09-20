// SPDX-License-Identifier: AGPL-3.0-or-later
/**
  ∩~~~~∩ 
  ξ ･×･ ξ 
  ξ　~　ξ 
  ξ　　 ξ 
  ξ　　 “~～~～〇 
  ξ　　　　　　 ξ 
  ξ ξ ξ~～~ξ ξ ξ 
　 ξ_ξξ_ξ　ξ_ξξ_ξ
Alpaca Fin Corporation
*/

pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "../../../interfaces/IAlpacaFairLaunch.sol";
import "../../../interfaces/IFarmableTokenAdapter.sol";
import "../../../interfaces/ITimeLock.sol";
import "../../../interfaces/IShield.sol";
import "../../../utils/SafeToken.sol";

import "./BaseFarmableTokenAdapter.sol";

/// @title IbTokenAdapter is the adapter that inherited BaseFarmableTokenAdapter.
/// It receives Alpaca's ibTOKEN from users and deposit in Alpaca's FairLaunch.
/// Hence, users will still earn ALPACA rewards while holding positions.
contract IbTokenAdapter is
  IFarmableTokenAdapter,
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable
{
  using SafeToken for address;

  uint256 internal constant WAD = 10**18;
  uint256 internal constant RAY = 10**27;

  /// @dev The Alpaca's Fairlaunch contract
  IAlpacaFairLaunch public fairlaunch;
  /// @dev The Alpaca's Shield contract
  IShield public shield;
  /// @dev The Timelock that owns Shield
  ITimeLock public timelock;
  /// @dev The pool id that this ibTokenAdapter is working with
  uint256 public pid;

  uint256 public treasuryFeeBps;
  address public treasuryAccount;

  uint256 public live;

  /// @dev Book Keeper instance
  IBookKeeper public bookKeeper;
  /// @dev Collateral Pool ID
  bytes32 public override collateralPoolId;
  /// @dev Token that is used for collateral
  address public override collateralToken;
  /// @dev The decimals of collateralToken
  uint256 public override decimals;
  /// @dev The token that will get after collateral has been staked
  IToken public rewardToken;

  /// @dev Rewards per collateralToken in RAY
  uint256 public accRewardPerShare;
  /// @dev Total CollateralTokens that has been staked in WAD
  uint256 public totalShare;
  /// @dev Accummulate reward balance in WAD
  uint256 public accRewardBalance;

  /// @dev Mapping of user => rewardDebts
  mapping(address => uint256) public rewardDebts;
  /// @dev Mapping of user => collteralTokens that he is staking
  mapping(address => uint256) public stake;

  uint256 internal to18ConversionFactor;
  uint256 internal toTokenConversionFactor;

  /// @notice Events
  event Deposit(uint256 val);
  event Withdraw(uint256 val);
  event EmergencyWithdaraw();
  event MoveStake(address indexed src, address indexed dst, uint256 wad);

  // --- Auth ---
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;

  modifier onlyOwner() {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    _;
  }

  function initialize(
    address _bookKeeper,
    bytes32 _collateralPoolId,
    address _collateralToken,
    address _rewardToken,
    address _fairlaunch,
    uint256 _pid,
    address _shield,
    address _timelock,
    uint256 _treasuryFeeBps,
    address _treasuryAccount
  ) external initializer {
    // 1. Initialized all dependencies
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    _setupRole(OWNER_ROLE, msg.sender);

    // 2. Sanity checks
    (address stakeToken, , , , ) = IAlpacaFairLaunch(_fairlaunch).poolInfo(_pid);
    require(stakeToken == _collateralToken, "IbTokenAdapter/collateralToken-not-match");
    require(IAlpacaFairLaunch(_fairlaunch).alpaca() == _rewardToken, "IbTokenAdapter/reward-token-not-match");
    require(IAlpacaFairLaunch(_fairlaunch).owner() == _shield, "IbTokenAdapter/shield-not-match");
    require(IShield(_shield).owner() == _timelock, "IbTokenAdapter/timelock-not-match");

    fairlaunch = IAlpacaFairLaunch(_fairlaunch);
    shield = IShield(_shield);
    timelock = ITimeLock(_timelock);
    pid = _pid;

    live = 1;

    bookKeeper = IBookKeeper(_bookKeeper);
    collateralPoolId = _collateralPoolId;
    collateralToken = _collateralToken;
    decimals = IToken(collateralToken).decimals();
    require(decimals <= 18, "BaseFarmableToken/decimals > 18");

    to18ConversionFactor = 10**(18 - decimals);
    toTokenConversionFactor = 10**decimals;
    rewardToken = IToken(_rewardToken);

    treasuryFeeBps = _treasuryFeeBps;
    treasuryAccount = _treasuryAccount;

    address(collateralToken).safeApprove(address(fairlaunch), uint256(-1));
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

  function div(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y > 0, "ds-math-div-by-zero");
    z = x / y;
  }

  function divup(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = add(x, sub(y, 1)) / y;
  }

  function wmul(uint256 x, uint256 y) public pure returns (uint256 z) {
    z = mul(x, y) / WAD;
  }

  function wdiv(uint256 x, uint256 y) public pure returns (uint256 z) {
    z = mul(x, WAD) / y;
  }

  function wdivup(uint256 x, uint256 y) public pure returns (uint256 z) {
    z = divup(mul(x, WAD), y);
  }

  function rmul(uint256 x, uint256 y) public pure returns (uint256 z) {
    z = mul(x, y) / RAY;
  }

  function rmulup(uint256 x, uint256 y) public pure returns (uint256 z) {
    z = divup(mul(x, y), RAY);
  }

  function rdiv(uint256 x, uint256 y) public pure returns (uint256 z) {
    z = mul(x, RAY) / y;
  }

  /// @dev Ignore collateralTokens that have been directly transferred
  function netAssetValuation() public view returns (uint256) {
    return totalShare;
  }

  /// @dev Return Net Assets per Share in wad
  function netAssetPerShare() public view returns (uint256) {
    if (totalShare == 0) return WAD;
    else return wdiv(netAssetValuation(), totalShare);
  }

  /// @dev Harvest ALPACA from FairLaunch
  function _harvest() internal returns (uint256) {
    if (live == 1) {
      // Withdraw all rewards
      (uint256 stakedBalance, , , ) = fairlaunch.userInfo(pid, address(this));
      if (stakedBalance > 0) fairlaunch.withdraw(address(this), pid, 0);
    }
    return __harvest();
  }

  /// @dev Return the amount of rewards that is harvested.
  /// Expect that the adapter which inherited BaseFarmableTokenAdapter
  /// override this __harvest and perform actual harvest before return
  function __harvest() internal returns (uint256) {
    return sub(rewardToken.balanceOf(address(this)), accRewardBalance);
  }

  /// @dev Harvest rewards for "from" and send to "to"
  /// @param from The position address that is owned and staked the collateral tokens
  /// @param to The address to receive the yields
  function harvest(address from, address to) internal {
    // If invalid address, do not harvest to avoid confusion in the reward accounting.
    if (from == address(0) || to == address(0)) return;
    // 1. Perform actual harvest. Calculate the new accRewardPerShare.
    if (totalShare > 0) accRewardPerShare = add(accRewardPerShare, rdiv(_harvest(), totalShare));

    // 2. Calculate the rewards that "to" should get by:
    // stake[from] * accRewardPerShare (rewards that each share should get) - rewardDebts (what already paid)
    uint256 rewardDebt = rewardDebts[from];
    uint256 rewards = rmul(stake[from], accRewardPerShare);
    if (rewards > rewardDebt) {
      uint256 back = sub(rewards, rewardDebt);
      uint256 treasuryFee = div(mul(back, treasuryFeeBps), 10000);
      address(rewardToken).safeTransfer(treasuryAccount, treasuryFee);
      address(rewardToken).safeTransfer(to, sub(back, treasuryFee));
    }

    // 3. Update accRewardBalance
    accRewardBalance = rewardToken.balanceOf(address(this));
  }

  /// @dev For FE to query pending rewards of a given positionAddress
  /// @param positionAddress The address that you want to check pending ALPACA
  function pendingRewards(address positionAddress) external view returns (uint256) {
    return _pendingRewards(positionAddress, fairlaunch.pendingAlpaca(pid, address(this)));
  }

  /// @dev Return the amount of rewards to be harvested for a giving position address
  /// @param positionAddress The position address
  /// @param pending The pending rewards from staking contract
  function _pendingRewards(address positionAddress, uint256 pending) internal view returns (uint256) {
    if (totalShare == 0) return 0;
    uint256 toBeHarvested = sub(add(pending, rewardToken.balanceOf(address(this))), accRewardBalance);
    uint256 pendingAccRewardPerShare = add(accRewardPerShare, rdiv(toBeHarvested, totalShare));
    return sub(rmul(stake[positionAddress], pendingAccRewardPerShare), rewardDebts[positionAddress]);
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
    _deposit(positionAddress, val, data);
    fairlaunch.deposit(address(this), pid, val);
  }

  /// @dev Harvest rewardTokens and distribute to user,
  /// deposit collateral tokens to staking contract, and update BookKeeper
  /// @param positionAddress The position address to be updated
  /// @param amount The amount to be deposited
  /// @param data The extra data information pass along to this adapter
  function _deposit(
    address positionAddress,
    uint256 amount,
    bytes calldata data
  ) private {
    require(live == 1, "BaseFarmableToken/not live");
    address user = abi.decode(data, (address));
    harvest(positionAddress, user);
    if (amount > 0) {
      uint256 wad = wdiv(mul(amount, to18ConversionFactor), netAssetPerShare());

      // Overflow check for int256(wad) cast below
      // Also enforces a non-zero wad
      require(int256(wad) > 0, "BaseFarmableToken/wad overflow");

      address(collateralToken).safeTransferFrom(msg.sender, address(this), amount);
      bookKeeper.addCollateral(collateralPoolId, positionAddress, int256(wad));

      totalShare = add(totalShare, wad);
      stake[positionAddress] = add(stake[positionAddress], wad);
    }
    rewardDebts[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);

    emit Deposit(amount);
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
    _withdraw(positionAddress, val, data);
  }

  /// @dev Harvest rewardTokens and distribute to user,
  /// withdraw collateral tokens from staking contract, and update BookKeeper
  /// @param positionAddress The position address to be updated
  /// @param amount The amount to be deposited
  /// @param data The extra data information pass along to this adapter
  function _withdraw(
    address positionAddress,
    uint256 amount,
    bytes calldata data
  ) private {
    address user = abi.decode(data, (address));
    harvest(positionAddress, user);
    if (amount > 0) {
      uint256 wad = wdivup(mul(amount, to18ConversionFactor), netAssetPerShare());

      // Overflow check for int256(wad) cast below
      // Also enforces a non-zero wad
      require(int256(wad) > 0, "BaseFarmableToken/wad overflow");
      require(stake[positionAddress] >= wad, "BaseFarmableToken/insufficient staked amount");

      address(collateralToken).safeTransfer(user, amount);
      bookKeeper.addCollateral(collateralPoolId, positionAddress, -int256(wad));

      totalShare = sub(totalShare, wad);
      stake[positionAddress] = sub(stake[positionAddress], wad);
    }
    rewardDebts[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);

    emit Withdraw(amount);
  }

  /// @dev EMERGENCY ONLY. Withdraw ibToken from FairLaunch with invoking "_harvest"
  function emergencyWithdraw(address positionAddress, address to) public nonReentrant {
    if (live == 1) {
      uint256 val = bookKeeper.collateralToken(collateralPoolId, positionAddress);
      fairlaunch.withdraw(address(this), pid, val);
    }
    _emergencyWithdraw(positionAddress, to);
  }

  /// @dev EMERGENCY ONLY. Withdraw collateralTokens from staking contract without invoking _harvest
  /// @param positionAddress The positionAddress to do emergency withdraw
  /// @param to The address to received collateralTokens
  function _emergencyWithdraw(address positionAddress, address to) private {
    uint256 wad = bookKeeper.collateralToken(collateralPoolId, positionAddress);
    require(wad <= 2**255, "BaseFarmableTokenAdapter/wad overflow");
    uint256 val = wmul(wmul(wad, netAssetPerShare()), toTokenConversionFactor);

    address(collateralToken).safeTransfer(to, val);
    bookKeeper.addCollateral(collateralPoolId, positionAddress, -int256(wad));

    totalShare = sub(totalShare, wad);
    stake[positionAddress] = sub(stake[positionAddress], wad);
    rewardDebts[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);

    emit EmergencyWithdaraw();
  }

  /// @dev Move wad amount of staked balance from source to destination.
  /// Can only be moved if underlaying assets make sense.
  /// @param source The address to be moved staked balance from
  /// @param destination The address to be moved staked balance to
  /// @param wad The amount of staked balance to be moved
  function moveStake(
    address source,
    address destination,
    uint256 wad,
    bytes calldata /* data */
  ) public override {
    // 1. Update collateral tokens for source and destination
    uint256 stakedAmount = stake[source];
    stake[source] = sub(stakedAmount, wad);
    stake[destination] = add(stake[destination], wad);

    // 2. Update source's rewardDebt due to collateral tokens have
    // moved from source to destination. Hence, rewardDebt should be updated.
    // dRewardDebt is how many rewards has been paid for that wad.
    uint256 rewardDebt = rewardDebts[source];
    uint256 dRewardDebt = mul(rewardDebt, wad) / stakedAmount;

    // 3. Update rewardDebts for both source and destination
    // Safe since dRewardDebt <= rewardDebts[source]
    rewardDebts[source] = rewardDebt - dRewardDebt;
    rewardDebts[destination] = add(rewardDebts[destination], dRewardDebt);

    // 4. Sanity check.
    // - stake[source] must more than or equal to collateral + lockedCollateral that source has
    // to prevent a case where someone try to steal stake from source
    // - stake[destination] must less than or eqal to collateral + lockedCollateral that destination has
    // to prevent destination from claim stake > actual collateral that he has
    (uint256 lockedCollateral, ) = bookKeeper.positions(collateralPoolId, source);
    require(
      stake[source] >= add(bookKeeper.collateralToken(collateralPoolId, source), lockedCollateral),
      "BaseFarmableTokenAdapter/stake[source] < collateralTokens + lockedCollateral"
    );
    (lockedCollateral, ) = bookKeeper.positions(collateralPoolId, destination);
    require(
      stake[destination] <= add(bookKeeper.collateralToken(collateralPoolId, destination), lockedCollateral),
      "BaseFarmableTokenAdapter/stake[destination] > collateralTokens + lockedCollateral"
    );

    emit MoveStake(source, destination, wad);
  }

  /// @dev Hook function when PositionManager adjust position.
  function onAdjustPosition(
    address source,
    address destination,
    int256 collateralValue,
    int256, /* debtShare */
    bytes calldata data
  ) external override nonReentrant {
    uint256 unsignedCollateralValue = collateralValue < 0 ? uint256(-collateralValue) : uint256(collateralValue);
    moveStake(source, destination, unsignedCollateralValue, data);
  }

  function onMoveCollateral(
    address source,
    address destination,
    uint256 wad,
    bytes calldata data
  ) external override nonReentrant {
    deposit(source, 0, data);
    moveStake(source, destination, wad, data);
  }

  function setTreasuryFeeBps(uint256 _data) external onlyOwner {
    require(live == 1, "IbTokenAdapter/not-live");
    treasuryFeeBps = _data;
  }

  function setTreasuryAccount(uint256 _data) external onlyOwner {
    require(live == 1, "IbTokenAdapter/not-live");
    treasuryFeeBps = _data;
  }

  /// @dev Pause ibTokenAdapter when assumptions change
  function cage() public override nonReentrant {
    require(live == 1, "IbTokenAdapter/not-live");

    // Allow caging if
    // - msg.sender is whitelisted to do so
    // - Shield's owner has been changed
    require(hasRole(OWNER_ROLE, msg.sender) || shield.owner() != address(timelock), "IbTokenAdapter/not-authorized");

    _cage();
  }

  function _cage() internal {
    fairlaunch.emergencyWithdraw(pid);
    live = 0;
  }

  function uncage() external onlyOwner {
    require(live == 0, "IbTokenAdapter/not-caged");
    fairlaunch.deposit(address(this), pid, totalShare);
    live = 1;
  }
}
