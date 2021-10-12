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
contract IbTokenAdapter is IFarmableTokenAdapter, PausableUpgradeable, ReentrancyGuardUpgradeable, ICagable {
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
  event Deposit(uint256 _val);
  event Withdraw(uint256 _val);
  event EmergencyWithdaraw();
  event MoveStake(address indexed _src, address indexed _dst, uint256 _wad);

  modifier onlyOwner() {
    IAccessControlConfig _accessControlConfig = IAccessControlConfig(bookKeeper.accessControlConfig());
    require(_accessControlConfig.hasRole(_accessControlConfig.OWNER_ROLE(), msg.sender), "!ownerRole");
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
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    // 2. Sanity checks
    (address _stakeToken, , , , ) = IAlpacaFairLaunch(_fairlaunch).poolInfo(_pid);
    require(_stakeToken == _collateralToken, "IbTokenAdapter/collateralToken-not-match");
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
  }

  function add(uint256 _x, uint256 _y) internal pure returns (uint256 _z) {
    require((_z = _x + _y) >= _x, "ds-math-add-overflow");
  }

  function sub(uint256 _x, uint256 _y) internal pure returns (uint256 _z) {
    require((_z = _x - _y) <= _x, "ds-math-sub-underflow");
  }

  function mul(uint256 _x, uint256 _y) internal pure returns (uint256 _z) {
    require(_y == 0 || (_z = _x * _y) / _y == _x, "ds-math-mul-overflow");
  }

  function div(uint256 _x, uint256 _y) internal pure returns (uint256 _z) {
    require(_y > 0, "ds-math-div-by-zero");
    _z = _x / _y;
  }

  function divup(uint256 _x, uint256 _y) internal pure returns (uint256 _z) {
    _z = add(_x, sub(_y, 1)) / _y;
  }

  function wmul(uint256 _x, uint256 _y) internal pure returns (uint256 _z) {
    _z = mul(_x, _y) / WAD;
  }

  function wdiv(uint256 _x, uint256 _y) internal pure returns (uint256 _z) {
    _z = mul(_x, WAD) / _y;
  }

  function wdivup(uint256 _x, uint256 _y) internal pure returns (uint256 _z) {
    _z = divup(mul(_x, WAD), _y);
  }

  function rmul(uint256 _x, uint256 _y) internal pure returns (uint256 _z) {
    _z = mul(_x, _y) / RAY;
  }

  function rmulup(uint256 _x, uint256 _y) internal pure returns (uint256 _z) {
    _z = divup(mul(_x, _y), RAY);
  }

  function rdiv(uint256 _x, uint256 _y) internal pure returns (uint256 _z) {
    _z = mul(_x, RAY) / _y;
  }

  function setTreasuryFeeBps(uint256 _treasuryFeeBps) external onlyOwner {
    require(live == 1, "IbTokenAdapter/not-live");
    require(_treasuryFeeBps <= 5000, "IbTokenAdapter/bad treasury fee bps");
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
      (uint256 _stakedBalance, , , ) = fairlaunch.userInfo(pid, address(this));
      if (_stakedBalance > 0) fairlaunch.withdraw(address(this), pid, 0);
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
    uint256 _rewardDebt = rewardDebts[_positionAddress];
    uint256 _rewards = rmul(stake[_positionAddress], accRewardPerShare);
    if (_rewards > _rewardDebt) {
      uint256 _back = sub(_rewards, _rewardDebt);
      uint256 _treasuryFee = div(mul(_back, treasuryFeeBps), 10000);
      address(rewardToken).safeTransfer(treasuryAccount, _treasuryFee);
      address(rewardToken).safeTransfer(_harvestTo, sub(_back, _treasuryFee));
    }

    // 3. Update accRewardBalance
    accRewardBalance = rewardToken.balanceOf(address(this));
  }

  /// @dev For FE to query pending rewards of a given positionAddress
  /// @param _positionAddress The address that you want to check pending ALPACA
  function pendingRewards(address _positionAddress) external view returns (uint256) {
    return _pendingRewards(_positionAddress, fairlaunch.pendingAlpaca(pid, address(this)));
  }

  /// @dev Return the amount of rewards to be harvested for a giving position address
  /// @param _positionAddress The position address
  /// @param _pending The pending rewards from staking contract
  function _pendingRewards(address _positionAddress, uint256 _pending) internal view returns (uint256) {
    if (totalShare == 0) return 0;
    uint256 _toBeHarvested = sub(add(_pending, rewardToken.balanceOf(address(this))), accRewardBalance);
    uint256 _pendingAccRewardPerShare = add(accRewardPerShare, rdiv(_toBeHarvested, totalShare));
    return sub(rmul(stake[_positionAddress], _pendingAccRewardPerShare), rewardDebts[_positionAddress]);
  }

  /// @dev Harvest and deposit received ibToken to FairLaunch
  /// @param _positionAddress The address that holding states of the position
  /// @param _amount The ibToken amount that being used as a collateral and to be deposited to FairLaunch
  /// @param _data The extra data that may needs to execute the deposit
  function deposit(
    address _positionAddress,
    uint256 _amount,
    bytes calldata _data
  ) external payable override nonReentrant whenNotPaused {
    _deposit(_positionAddress, _amount, _data);
  }

  /// @dev Harvest rewardTokens and distribute to user,
  /// deposit collateral tokens to staking contract, and update BookKeeper
  /// @param _positionAddress The position address to be updated
  /// @param _amount The amount to be deposited
  /// @param _data The extra data information pass along to this adapter
  function _deposit(
    address _positionAddress,
    uint256 _amount,
    bytes calldata _data
  ) private {
    require(live == 1, "IbTokenAdapter/not live");

    // Try to decode user address for harvested rewards from calldata
    // if the user address is not passed, then send zero address to `harvest` and let it handle
    address _user = address(0);
    if (_data.length > 0) _user = abi.decode(_data, (address));
    harvest(_positionAddress, _user);

    if (_amount > 0) {
      uint256 _share = wdiv(mul(_amount, to18ConversionFactor), netAssetPerShare()); // [wad]
      // Overflow check for int256(wad) cast below
      // Also enforces a non-zero wad
      require(int256(_share) > 0, "IbTokenAdapter/share-overflow");
      address(collateralToken).safeTransferFrom(msg.sender, address(this), _amount);
      bookKeeper.addCollateral(collateralPoolId, _positionAddress, int256(_share));
      totalShare = add(totalShare, _share);
      stake[_positionAddress] = add(stake[_positionAddress], _share);
    }
    rewardDebts[_positionAddress] = rmulup(stake[_positionAddress], accRewardPerShare);

    fairlaunch.deposit(address(this), pid, _amount);

    emit Deposit(_amount);
  }

  /// @dev Harvest and withdraw ibToken from FairLaunch
  /// @param _positionAddress The address that holding states of the position
  /// @param _amount The ibToken amount to be withdrawn from FairLaunch and return to user
  /// @param _data The extra data that may needs to execute the withdraw
  function withdraw(
    address _positionAddress,
    uint256 _amount,
    bytes calldata _data
  ) external override nonReentrant whenNotPaused {
    if (live == 1) {
      fairlaunch.withdraw(address(this), pid, _amount);
    }
    _withdraw(_positionAddress, _amount, _data);
  }

  /// @dev Harvest rewardTokens and distribute to user,
  /// withdraw collateral tokens from staking contract, and update BookKeeper
  /// @param _positionAddress The position address to be updated
  /// @param _amount The amount to be deposited
  /// @param _data The extra data information pass along to this adapter
  function _withdraw(
    address _positionAddress,
    uint256 _amount,
    bytes calldata _data
  ) private {
    // Try to decode user address for harvested rewards from calldata
    // if the user address is not passed, then send zero address to `harvest` and let it handle
    address _user = address(0);
    if (_data.length > 0) _user = abi.decode(_data, (address));
    harvest(_positionAddress, _user);

    if (_amount > 0) {
      uint256 _share = wdivup(mul(_amount, to18ConversionFactor), netAssetPerShare()); // [wad]
      // Overflow check for int256(wad) cast below
      // Also enforces a non-zero wad
      require(int256(_share) > 0, "IbTokenAdapter/share-overflow");
      require(stake[_positionAddress] >= _share, "IbTokenAdapter/insufficient staked amount");

      address(collateralToken).safeTransfer(_user, _amount);
      bookKeeper.addCollateral(collateralPoolId, _positionAddress, -int256(_share));
      totalShare = sub(totalShare, _share);
      stake[_positionAddress] = sub(stake[_positionAddress], _share);
    }
    rewardDebts[_positionAddress] = rmulup(stake[_positionAddress], accRewardPerShare);
    emit Withdraw(_amount);
  }

  /// @dev EMERGENCY ONLY. Withdraw ibToken from FairLaunch with invoking "_harvest"
  function emergencyWithdraw(address _positionAddress, address _to) external nonReentrant whenNotPaused {
    if (live == 1) {
      uint256 _amount = bookKeeper.collateralToken(collateralPoolId, _positionAddress);
      fairlaunch.withdraw(address(this), pid, _amount);
    }
    _emergencyWithdraw(_positionAddress, _to);
  }

  /// @dev EMERGENCY ONLY. Withdraw collateralTokens from staking contract without invoking _harvest
  /// @param _positionAddress The positionAddress to do emergency withdraw
  /// @param _to The address to received collateralTokens
  function _emergencyWithdraw(address _positionAddress, address _to) private {
    uint256 _share = bookKeeper.collateralToken(collateralPoolId, _positionAddress); //[wad]
    require(_share <= 2**255, "IbTokenAdapter/share-overflow");
    uint256 _amount = wmul(wmul(_share, netAssetPerShare()), toTokenConversionFactor);
    address(collateralToken).safeTransfer(_to, _amount);
    bookKeeper.addCollateral(collateralPoolId, _positionAddress, -int256(_share));
    totalShare = sub(totalShare, _share);
    stake[_positionAddress] = sub(stake[_positionAddress], _share);
    rewardDebts[_positionAddress] = rmulup(stake[_positionAddress], accRewardPerShare);
    emit EmergencyWithdaraw();
  }

  function moveStake(
    address _source,
    address _destination,
    uint256 _share,
    bytes calldata _data
  ) external override nonReentrant whenNotPaused {
    _moveStake(_source, _destination, _share, _data);
  }

  /// @dev Move wad amount of staked balance from source to destination.
  /// Can only be moved if underlaying assets make sense.
  /// @param _source The address to be moved staked balance from
  /// @param _destination The address to be moved staked balance to
  /// @param _share The amount of staked balance to be moved
  function _moveStake(
    address _source,
    address _destination,
    uint256 _share,
    bytes calldata /* data */
  ) private {
    // 1. Update collateral tokens for source and destination
    uint256 _stakedAmount = stake[_source];
    stake[_source] = sub(_stakedAmount, _share);
    stake[_destination] = add(stake[_destination], _share);
    // 2. Update source's rewardDebt due to collateral tokens have
    // moved from source to destination. Hence, rewardDebt should be updated.
    // rewardDebtDiff is how many rewards has been paid for that share.
    uint256 _rewardDebt = rewardDebts[_source];
    uint256 _rewardDebtDiff = mul(_rewardDebt, _share) / _stakedAmount;
    // 3. Update rewardDebts for both source and destination
    // Safe since rewardDebtDiff <= rewardDebts[source]
    rewardDebts[_source] = _rewardDebt - _rewardDebtDiff;
    rewardDebts[_destination] = add(rewardDebts[_destination], _rewardDebtDiff);
    // 4. Sanity check.
    // - stake[source] must more than or equal to collateral + lockedCollateral that source has
    // to prevent a case where someone try to steal stake from source
    // - stake[destination] must less than or eqal to collateral + lockedCollateral that destination has
    // to prevent destination from claim stake > actual collateral that he has
    (uint256 _lockedCollateral, ) = bookKeeper.positions(collateralPoolId, _source);
    require(
      stake[_source] >= add(bookKeeper.collateralToken(collateralPoolId, _source), _lockedCollateral),
      "IbTokenAdapter/stake[source] < collateralTokens + lockedCollateral"
    );
    (_lockedCollateral, ) = bookKeeper.positions(collateralPoolId, _destination);
    require(
      stake[_destination] <= add(bookKeeper.collateralToken(collateralPoolId, _destination), _lockedCollateral),
      "IbTokenAdapter/stake[destination] > collateralTokens + lockedCollateral"
    );
    emit MoveStake(_source, _destination, _share);
  }

  /// @dev Hook function when PositionManager adjust position.
  function onAdjustPosition(
    address _source,
    address _destination,
    int256 _collateralValue,
    int256, /* debtShare */
    bytes calldata _data
  ) external override nonReentrant whenNotPaused {
    uint256 _unsignedCollateralValue = _collateralValue < 0 ? uint256(-_collateralValue) : uint256(_collateralValue);
    _moveStake(_source, _destination, _unsignedCollateralValue, _data);
  }

  function onMoveCollateral(
    address _source,
    address _destination,
    uint256 _share,
    bytes calldata _data
  ) external override nonReentrant whenNotPaused {
    _deposit(_source, 0, _data);
    _moveStake(_source, _destination, _share, _data);
  }

  /// @dev Pause ibTokenAdapter when assumptions change
  function cage() external override nonReentrant {
    // Allow caging if
    // - msg.sender is whitelisted to do so
    // - Shield's owner has been changed
    IAccessControlConfig _accessControlConfig = IAccessControlConfig(bookKeeper.accessControlConfig());
    require(
      _accessControlConfig.hasRole(_accessControlConfig.OWNER_ROLE(), msg.sender) ||
        shield.owner() != address(timelock),
      "IbTokenAdapter/not-authorized"
    );
    require(live == 1, "IbTokenAdapter/not-live");
    fairlaunch.emergencyWithdraw(pid);
    live = 0;
    emit Cage();
  }

  function uncage() external override {
    IAccessControlConfig _accessControlConfig = IAccessControlConfig(bookKeeper.accessControlConfig());
    require(
      _accessControlConfig.hasRole(_accessControlConfig.OWNER_ROLE(), msg.sender),
      "IbTokenAdapter/not-authorized"
    );
    require(live == 0, "IbTokenAdapter/not-caged");
    fairlaunch.deposit(address(this), pid, totalShare);
    live = 1;
    emit Uncage();
  }

  // --- pause ---
  function pause() external {
    IAccessControlConfig _accessControlConfig = IAccessControlConfig(bookKeeper.accessControlConfig());
    require(
      _accessControlConfig.hasRole(_accessControlConfig.OWNER_ROLE(), msg.sender) ||
        _accessControlConfig.hasRole(_accessControlConfig.GOV_ROLE(), msg.sender),
      "!(ownerRole or govRole)"
    );
    _pause();
  }

  function unpause() external {
    IAccessControlConfig _accessControlConfig = IAccessControlConfig(bookKeeper.accessControlConfig());
    require(
      _accessControlConfig.hasRole(_accessControlConfig.OWNER_ROLE(), msg.sender) ||
        _accessControlConfig.hasRole(_accessControlConfig.GOV_ROLE(), msg.sender),
      "!(ownerRole or govRole)"
    );
    _unpause();
  }
}
