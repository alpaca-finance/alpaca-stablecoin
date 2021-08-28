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

  /// @dev Rewards per collateralToken in ray
  uint256 public accRewardPerShare;
  /// @dev Total CollateralTokens that has been staked in wad
  uint256 public totalShare;
  /// @dev Accummulate reward balance in wad
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
  event Flee();
  event MoveRewards(address indexed src, address indexed dst, uint256 wad);
  event Rely(address indexed usr);
  event Deny(address indexed usr);

  modifier auth() {
    require(whitelist[msg.sender] == 1, "FarmableToken/not-authed");
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
    require(decimals <= 18, "FarmableToken/decimals > 18");

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

  /// @dev Return the amount of rewards that is harvested.
  /// Expect that the adapter which inherited BaseFarmableTokenAdapter
  /// override this _harvest and perform actual harvest before return
  function _harvest() internal view returns (uint256) {
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

  /// @dev Harvest rewardTokens and distribute to user, deposit collateral tokens to staking contract
  /// ,and update BookKeeper
  /// @param positionAddress The position address to be updated
  /// @param val The amount to be deposited
  /// @param data The extra data information pass along to this adapter
  function deposit(
    address positionAddress,
    uint256 val,
    bytes calldata data
  ) public payable virtual override {
    require(live == 1, "FarmableToken/not live");
    address user = abi.decode(data, (address));
    harvest(positionAddress, user);
    if (val > 0) {
      uint256 wad = wdiv(mul(val, to18ConversionFactor), netAssetperShare());

      // Overflow check for int256(wad) cast below
      // Also enforces a non-zero wad
      require(int256(wad) > 0, "FarmableToken/wad overflow");

      address(collateralToken).safeTransferFrom(msg.sender, address(this), val);
      bookKeeper.addCollateral(collateralPoolId, positionAddress, int256(wad));

      totalShare = add(totalShare, wad);
      stake[positionAddress] = add(stake[positionAddress], wad);
    }
    rewardDebts[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);
    emit Deposit(val);
  }

  function withdraw(
    address positionAddress,
    uint256 val,
    bytes calldata data
  ) public virtual override {
    (address usr, bytes memory ext) = abi.decode(data, (address, bytes));
    harvest(positionAddress, usr);
    if (val > 0) {
      uint256 wad = wdivup(mul(val, to18ConversionFactor), nps());

      // Overflow check for int256(wad) cast below
      // Also enforces a non-zero wad
      require(int256(wad) > 0);

      address(collateralToken).safeTransfer(usr, val);
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

    address(collateralToken).safeTransfer(usr, val);
    bookKeeper.addCollateral(collateralPoolId, positionAddress, -int256(wad));

    totalShare = sub(totalShare, wad);
    stake[positionAddress] = sub(stake[positionAddress], wad);
    rewardDebts[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);

    emit Flee();
  }

  function moveRewards(
    address src,
    address dst,
    uint256 wad,
    bytes calldata data
  ) public override {
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

  function onAdjustPosition(
    address src,
    address dst,
    int256 collateralValue,
    int256 debtShare,
    bytes calldata data
  ) external override nonReentrant {
    uint256 unsignedCollateralValue = collateralValue < 0 ? uint256(-collateralValue) : uint256(collateralValue);
    moveRewards(src, dst, unsignedCollateralValue, data);
  }

  function onMoveCollateral(
    address src,
    address dst,
    uint256 wad,
    bytes calldata data
  ) external override nonReentrant {
    deposit(src, 0, data);
    moveRewards(src, dst, wad, data);
  }

  function cage() public virtual override auth {
    live = 0;
  }

  /// @dev Gap for adding new variables later
  uint256[49] private __gap;
}
