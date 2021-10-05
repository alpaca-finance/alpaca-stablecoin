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
import "../../../interfaces/IBookKeeper.sol";
import "../../../interfaces/IFarmableTokenAdapter.sol";
import "../../../interfaces/ITimeLock.sol";
import "../../../interfaces/IShield.sol";
import "../../../interfaces/ICagable.sol";
import "../../../interfaces/IManager.sol";
import "../../../utils/SafeToken.sol";

/// @title IbTokenAdapter is the adapter that inherited BaseFarmableTokenAdapter.
/// It receives Alpaca's ibTOKEN from users and deposit in Alpaca's FairLaunch.
/// Hence, users will still earn ALPACA rewards while holding positions.
contract IbTokenAdapter is
  IFarmableTokenAdapter,
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  ICagable
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

  IManager positionManager;

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
    address _treasuryAccount,
    address _positionManager
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
    require(decimals <= 18, "IbTokenAdapter/decimals > 18");

    to18ConversionFactor = 10**(18 - decimals);
    toTokenConversionFactor = 10**decimals;
    rewardToken = IToken(_rewardToken);

    require(_treasuryAccount != address(0), "IbTokenAdapter/bad treasury account");
    treasuryFeeBps = _treasuryFeeBps;
    treasuryAccount = _treasuryAccount;

    positionManager = IManager(_positionManager);

    address(collateralToken).safeApprove(address(fairlaunch), uint256(-1));

    // Grant the contract deployer the owner role: it will be able
    // to grant and revoke any roles
    _setupRole(OWNER_ROLE, msg.sender);
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

  function setTreasuryFeeBps(uint256 _treasuryFeeBps) external onlyOwner {
    require(live == 1, "IbTokenAdapter/not-live");
    require(treasuryFeeBps <= 5000, "IbTokenAdapter/bad treasury fee bps");
    treasuryFeeBps = _treasuryFeeBps;
  }

  function setTreasuryAccount(address _treasuryAccount) external onlyOwner {
    require(live == 1, "IbTokenAdapter/not-live");
    require(_treasuryAccount != address(0), "IbTokenAdapter/bad treasury account");
    treasuryAccount = _treasuryAccount;
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
  /// @dev Return the amount of rewards that is harvested.
  /// Expect that the adapter which inherited BaseFarmableTokenAdapter
  function _harvest() internal returns (uint256) {
    if (live == 1) {
      // Withdraw all rewards
      (uint256 stakedBalance, , , ) = fairlaunch.userInfo(pid, address(this));
      if (stakedBalance > 0) fairlaunch.withdraw(address(this), pid, 0);
    }
    return sub(rewardToken.balanceOf(address(this)), accRewardBalance);
  }

  /// @dev Harvest rewards for "_positionAddress" and send to "to"
  /// @param _positionAddress The position address that is owned and staked the collateral tokens
  /// @param _to The address to receive the yields
  function harvest(address _positionAddress, address _to) internal {
    // 1. Define the address to receive the harvested rewards
    // Give the rewards to the proxy wallet that owns this position address if there is any
    address _harvestTo = positionManager.mapPositionHandlerToOwner(_positionAddress);
    // if the position owner is not recognized by the position manager,
    // check if the msg.sender is the owner of this position and harvest to msg.sender.
    // or else, harvest to _to address decoded from additional calldata
    if (_harvestTo == address(0)) _harvestTo = msg.sender == _positionAddress ? msg.sender : _to;
    require(_harvestTo != address(0), "IbTokenAdapter/harvest-to-address-zero");
    // 2. Perform actual harvest. Calculate the new accRewardPerShare.
    if (totalShare > 0) accRewardPerShare = add(accRewardPerShare, rdiv(_harvest(), totalShare));
    // 3. Calculate the rewards that "to" should get by:
    // stake[_positionAddress] * accRewardPerShare (rewards that each share should get) - rewardDebts (what already paid)
    uint256 rewardDebt = rewardDebts[_positionAddress];
    uint256 rewards = rmul(stake[_positionAddress], accRewardPerShare);
    if (rewards > rewardDebt) {
      uint256 back = sub(rewards, rewardDebt);
      uint256 treasuryFee = div(mul(back, treasuryFeeBps), 10000);
      address(rewardToken).safeTransfer(treasuryAccount, treasuryFee);
      if (_harvestTo != address(0)) address(rewardToken).safeTransfer(_harvestTo, sub(back, treasuryFee));
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
  /// @param amount The ibToken amount that being used as a collateral and to be deposited to FairLaunch
  /// @param data The extra data that may needs to execute the deposit
  function deposit(
    address positionAddress,
    uint256 amount,
    bytes calldata data
  ) public payable override nonReentrant {
    _deposit(positionAddress, amount, data);
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
    require(live == 1, "IbTokenAdapter/not live");

    // Try to decode user address for harvested rewards from calldata
    // if the user address is not passed, then send zero address to `harvest` and let it handle
    address user = address(0);
    if (data.length > 0) user = abi.decode(data, (address));
    harvest(positionAddress, user);

    if (amount > 0) {
      uint256 share = wdiv(mul(amount, to18ConversionFactor), netAssetPerShare()); // [wad]

      // Overflow check for int256(wad) cast below
      // Also enforces a non-zero wad
      require(int256(share) > 0, "IbTokenAdapter/share-overflow");

      address(collateralToken).safeTransferFrom(msg.sender, address(this), amount);
      bookKeeper.addCollateral(collateralPoolId, positionAddress, int256(share));

      totalShare = add(totalShare, share);
      stake[positionAddress] = add(stake[positionAddress], share);
    }
    rewardDebts[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);

    fairlaunch.deposit(address(this), pid, amount);

    emit Deposit(amount);
  }

  /// @dev Harvest and withdraw ibToken from FairLaunch
  /// @param positionAddress The address that holding states of the position
  /// @param amount The ibToken amount to be withdrawn from FairLaunch and return to user
  /// @param data The extra data that may needs to execute the withdraw
  function withdraw(
    address positionAddress,
    uint256 amount,
    bytes calldata data
  ) public override nonReentrant {
    if (live == 1) {
      fairlaunch.withdraw(address(this), pid, amount);
    }
    _withdraw(positionAddress, amount, data);
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
    // Try to decode user address for harvested rewards from calldata
    // if the user address is not passed, then send zero address to `harvest` and let it handle
    address user = address(0);
    if (data.length > 0) user = abi.decode(data, (address));
    harvest(positionAddress, user);

    if (amount > 0) {
      uint256 share = wdivup(mul(amount, to18ConversionFactor), netAssetPerShare()); // [wad]

      // Overflow check for int256(wad) cast below
      // Also enforces a non-zero wad
      require(int256(share) > 0, "IbTokenAdapter/share-overflow");
      require(stake[positionAddress] >= share, "IbTokenAdapter/insufficient staked amount");

      address(collateralToken).safeTransfer(user, amount);
      bookKeeper.addCollateral(collateralPoolId, positionAddress, -int256(share));

      totalShare = sub(totalShare, share);
      stake[positionAddress] = sub(stake[positionAddress], share);
    }
    rewardDebts[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);

    emit Withdraw(amount);
  }

  /// @dev EMERGENCY ONLY. Withdraw ibToken from FairLaunch with invoking "_harvest"
  function emergencyWithdraw(address positionAddress, address to) public nonReentrant {
    if (live == 1) {
      uint256 amount = bookKeeper.collateralToken(collateralPoolId, positionAddress);
      fairlaunch.withdraw(address(this), pid, amount);
    }
    _emergencyWithdraw(positionAddress, to);
  }

  /// @dev EMERGENCY ONLY. Withdraw collateralTokens from staking contract without invoking _harvest
  /// @param positionAddress The positionAddress to do emergency withdraw
  /// @param to The address to received collateralTokens
  function _emergencyWithdraw(address positionAddress, address to) private {
    uint256 share = bookKeeper.collateralToken(collateralPoolId, positionAddress); //[wad]
    require(share <= 2**255, "IbTokenAdapter/share-overflow");
    uint256 amount = wmul(wmul(share, netAssetPerShare()), toTokenConversionFactor);

    address(collateralToken).safeTransfer(to, amount);
    bookKeeper.addCollateral(collateralPoolId, positionAddress, -int256(share));

    totalShare = sub(totalShare, share);
    stake[positionAddress] = sub(stake[positionAddress], share);
    rewardDebts[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);

    emit EmergencyWithdaraw();
  }

  /// @dev Move wad amount of staked balance from source to destination.
  /// Can only be moved if underlaying assets make sense.
  /// @param source The address to be moved staked balance from
  /// @param destination The address to be moved staked balance to
  /// @param share The amount of staked balance to be moved
  function moveStake(
    address source,
    address destination,
    uint256 share,
    bytes calldata /* data */
  ) public override {
    // 1. Update collateral tokens for source and destination
    uint256 stakedAmount = stake[source];
    stake[source] = sub(stakedAmount, share);
    stake[destination] = add(stake[destination], share);

    // 2. Update source's rewardDebt due to collateral tokens have
    // moved from source to destination. Hence, rewardDebt should be updated.
    // rewardDebtDiff is how many rewards has been paid for that share.
    uint256 rewardDebt = rewardDebts[source];
    uint256 rewardDebtDiff = mul(rewardDebt, share) / stakedAmount;

    // 3. Update rewardDebts for both source and destination
    // Safe since rewardDebtDiff <= rewardDebts[source]
    rewardDebts[source] = rewardDebt - rewardDebtDiff;
    rewardDebts[destination] = add(rewardDebts[destination], rewardDebtDiff);

    // 4. Sanity check.
    // - stake[source] must more than or equal to collateral + lockedCollateral that source has
    // to prevent a case where someone try to steal stake from source
    // - stake[destination] must less than or eqal to collateral + lockedCollateral that destination has
    // to prevent destination from claim stake > actual collateral that he has
    (uint256 lockedCollateral, ) = bookKeeper.positions(collateralPoolId, source);
    require(
      stake[source] >= add(bookKeeper.collateralToken(collateralPoolId, source), lockedCollateral),
      "IbTokenAdapter/stake[source] < collateralTokens + lockedCollateral"
    );
    (lockedCollateral, ) = bookKeeper.positions(collateralPoolId, destination);
    require(
      stake[destination] <= add(bookKeeper.collateralToken(collateralPoolId, destination), lockedCollateral),
      "IbTokenAdapter/stake[destination] > collateralTokens + lockedCollateral"
    );

    emit MoveStake(source, destination, share);
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
    uint256 share,
    bytes calldata data
  ) external override nonReentrant {
    _deposit(source, 0, data);
    moveStake(source, destination, share, data);
  }

  /// @dev Pause ibTokenAdapter when assumptions change
  function cage() public override nonReentrant {
    // Allow caging if
    // - msg.sender is whitelisted to do so
    // - Shield's owner has been changed
    require(hasRole(OWNER_ROLE, msg.sender) || shield.owner() != address(timelock), "IbTokenAdapter/not-authorized");
    require(live == 1, "IbTokenAdapter/not-live");
    fairlaunch.emergencyWithdraw(pid);
    live = 0;
    emit Cage();
  }

  function uncage() external override {
    require(hasRole(OWNER_ROLE, msg.sender), "IbTokenAdapter/not-authorized");
    require(live == 0, "IbTokenAdapter/not-caged");
    fairlaunch.deposit(address(this), pid, totalShare);
    live = 1;
    emit Uncage();
  }
}
