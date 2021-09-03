// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "../../../interfaces/IBookKeeper.sol";
import "../../../interfaces/IToken.sol";
import "../../../interfaces/IFarmableTokenAdapter.sol";
import "../../../interfaces/IGenericTokenAdapter.sol";
import "../../../interfaces/IManager.sol";
import "../../../utils/SafeToken.sol";

/// @title BaseFarmableTokenAdapter is the base for adapters that receives tokens which can be farmed in other places
/// and shares yields among depositors. Hence, higher capital effciency!
contract BaseFarmableTokenAdapter is Initializable, IFarmableTokenAdapter, ReentrancyGuardUpgradeable {
  using SafeToken for address;

  uint256 internal constant WAD = 10**18;
  uint256 internal constant RAY = 10**27;

  /// @dev Mapping of whitelisted address that can pause FarmableTokenAdapter
  mapping(address => uint256) public whitelist;
  uint256 public live;

  /// @dev Book Keeper instance
  IBookKeeper public bookKeeper;
  /// @dev Collateral Pool ID
  bytes32 public override collateralPoolId;
  /// @dev Token that is used for collateral
  IToken public override collateralToken;
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
  event Rely(address indexed usr);
  event Deny(address indexed usr);

  modifier auth() {
    require(whitelist[msg.sender] == 1, "BaseFarmableToken/not-authed");
    _;
  }

  function __FarmableTokenAdapter_init(
    address _bookKeeper,
    bytes32 _collateralPoolId,
    address _collateralToken,
    address _rewardToken
  ) internal initializer {
    __FarmableTokenAdapter_init_unchained(_bookKeeper, _collateralPoolId, _collateralToken, _rewardToken);
  }

  function __FarmableTokenAdapter_init_unchained(
    address _bookKeeper,
    bytes32 _collateralPoolId,
    address _collateralToken,
    address _rewardToken
  ) internal initializer {
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    whitelist[msg.sender] = 1;
    emit Rely(msg.sender);

    live = 1;

    bookKeeper = IBookKeeper(_bookKeeper);
    collateralPoolId = _collateralPoolId;
    collateralToken = IToken(_collateralToken);
    decimals = collateralToken.decimals();
    require(decimals <= 18, "BaseFarmableToken/decimals > 18");

    to18ConversionFactor = 10**(18 - decimals);
    toTokenConversionFactor = 10**decimals;
    rewardToken = IToken(_rewardToken);
  }

  function rely(address usr) external override auth {
    whitelist[usr] = 1;
    emit Rely(msg.sender);
  }

  function deny(address usr) external override auth {
    whitelist[usr] = 0;
    emit Deny(msg.sender);
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

  /// @dev Return Net Asset Valuation in wad
  function netAssetValuation() public view virtual returns (uint256) {
    uint256 balance = collateralToken.balanceOf(address(this));
    return mul(balance, to18ConversionFactor);
  }

  /// @dev Return Net Assets per Share in wad
  function netAssetperShare() public view returns (uint256) {
    if (totalShare == 0) return WAD;
    else return wdiv(netAssetValuation(), totalShare);
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

  /// @dev Return the amount of rewards that is harvested.
  /// Expect that the adapter which inherited BaseFarmableTokenAdapter
  /// override this _harvest and perform actual harvest before return
  function _harvest() internal virtual returns (uint256) {
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
    if (rewards > rewardDebt) address(rewardToken).safeTransfer(to, sub(rewards, rewardDebt));

    // 3. Update accRewardBalance
    accRewardBalance = rewardToken.balanceOf(address(this));
  }

  /// @dev Harvest rewardTokens and distribute to user,
  /// deposit collateral tokens to staking contract, and update BookKeeper
  /// @param positionAddress The position address to be updated
  /// @param amount The amount to be deposited
  /// @param data The extra data information pass along to this adapter
  function deposit(
    address positionAddress,
    uint256 amount,
    bytes calldata data
  ) public payable virtual override {
    require(live == 1, "BaseFarmableToken/not live");
    address user = abi.decode(data, (address));
    harvest(positionAddress, user);
    if (amount > 0) {
      uint256 wad = wdiv(mul(amount, to18ConversionFactor), netAssetperShare());

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

  /// @dev Harvest rewardTokens and distribute to user,
  /// withdraw collateral tokens from staking contract, and update BookKeeper
  /// @param positionAddress The position address to be updated
  /// @param amount The amount to be deposited
  /// @param data The extra data information pass along to this adapter
  function withdraw(
    address positionAddress,
    uint256 amount,
    bytes calldata data
  ) public virtual override {
    address user = abi.decode(data, (address));
    harvest(positionAddress, user);
    if (amount > 0) {
      uint256 wad = wdivup(mul(amount, to18ConversionFactor), netAssetperShare());

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

  /// @dev EMERGENCY ONLY. Withdraw collateralTokens from staking contract without invoking _harvest
  /// @param positionAddress The positionAddress to do emergency withdraw
  /// @param user The address to received collateralTokens
  function emergencyWithdraw(address positionAddress, address user) public virtual {
    uint256 wad = bookKeeper.collateralToken(collateralPoolId, positionAddress);
    require(wad <= 2**255, "BaseFarmableTokenAdapter/wad overflow");
    uint256 val = wmul(wmul(wad, netAssetperShare()), toTokenConversionFactor);

    address(collateralToken).safeTransfer(user, val);
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

  function cage() public virtual override auth {
    live = 0;
  }

  /// @dev Gap for adding new variables later
  uint256[49] private __gap;
}
