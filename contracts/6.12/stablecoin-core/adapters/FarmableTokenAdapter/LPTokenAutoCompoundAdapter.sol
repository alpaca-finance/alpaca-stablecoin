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
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "@alpaca-finance/alpaca-contract/contracts/6/protocol/apis/pancake/IPancakeRouter02.sol";
import "@pancakeswap-libs/pancake-swap-core/contracts/interfaces/IPancakePair.sol";
import "../../../interfaces/IBookKeeper.sol";
import "../../../interfaces/IFarmableTokenAdapter.sol";
import "../../../interfaces/ICagable.sol";
import "../../../interfaces/IManager.sol";
import "../../../interfaces/IPancakeMasterChef.sol";
import "../../../interfaces/IAlpacaVault.sol";
import "../../../interfaces/ILyfStrategy.sol";
import "../../../utils/SafeToken.sol";
import "hardhat/console.sol";

/// @title LPTokenAutoCompoundAdapter is the adapter that inherited BaseFarmableTokenAdapter.
/// It receives Alpaca's ibTOKEN from users and deposit in Alpaca's FairLaunch.
/// Hence, users will still earn ALPACA rewards while holding positions.
contract LPTokenAutoCompoundAdapter is
  IFarmableTokenAdapter,
  PausableUpgradeable,
  ReentrancyGuardUpgradeable,
  ICagable
{
  using SafeToken for address;
  using SafeMathUpgradeable for uint256;

  uint256 internal constant WAD = 10**18;
  uint256 internal constant RAY = 10**27;

  /// @dev MasterChef contract
  IPancakeMasterChef public masterChef;
  IPancakeRouter02 public router;
  IAlpacaVault public beneficialVault;
  uint256 public beneficialVaultBountyBps;
  address[] public rewardPath;
  address public wNative;
  address[] public reinvestPath;
  ILyfStrategy public addStrat;
  uint256 public buybackAmount;
  uint256 public reinvestThreshold;

  // worker interface
  address public baseToken;
  address public farmingToken;

  /// @dev The pool id that this LPTokenAdapter is working with
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
  address public rewardToken;

  IManager public positionManager;

  /// @dev Total CollateralTokens that has been staked in WAD
  uint256 public totalShare;

  /// @dev Mapping of user => collteralTokens that he is staking
  mapping(address => uint256) public stake;

  uint256 internal to18ConversionFactor;
  uint256 internal toTokenConversionFactor;

  /// @notice Events
  event LogSetBeneficialVaultConfig(
    address indexed caller,
    uint256 indexed beneficialVaultBountyBps,
    IAlpacaVault indexed beneficialVault,
    address[] rewardPath
  );
  event LogSetRewardPath(address indexed caller, address[] newRewardPath);
  event LogBeneficialVaultTokenBuyback(
    address indexed caller,
    IAlpacaVault indexed beneficialVault,
    uint256 indexed buyback
  );
  event LogReinvest(address indexed caller, uint256 reward, uint256 bounty);
  event LogDeposit(uint256 _val);
  event LogWithdraw(uint256 _val);
  event LogEmergencyWithdraw(address indexed _caller, address _to);
  event LogMoveStake(address indexed _src, address indexed _dst, uint256 _wad);
  event LogSetTreasuryAccount(address indexed _caller, address _treasuryAccount);
  event LogSetTreasuryFeeBps(address indexed _caller, uint256 _treasuryFeeBps);

  modifier onlyOwner() {
    IAccessControlConfig _accessControlConfig = IAccessControlConfig(bookKeeper.accessControlConfig());
    require(_accessControlConfig.hasRole(_accessControlConfig.OWNER_ROLE(), msg.sender), "!ownerRole");
    _;
  }

  modifier onlyOwnerOrGov() {
    IAccessControlConfig _accessControlConfig = IAccessControlConfig(bookKeeper.accessControlConfig());
    require(
      _accessControlConfig.hasRole(_accessControlConfig.OWNER_ROLE(), msg.sender) ||
        _accessControlConfig.hasRole(_accessControlConfig.GOV_ROLE(), msg.sender),
      "!(ownerRole or govRole)"
    );
    _;
  }

  modifier onlyCollateralManager() {
    IAccessControlConfig _accessControlConfig = IAccessControlConfig(bookKeeper.accessControlConfig());
    require(
      _accessControlConfig.hasRole(_accessControlConfig.COLLATERAL_MANAGER_ROLE(), msg.sender),
      "!collateralManager"
    );
    _;
  }

  modifier onlyReinvestor() {
    IAccessControlConfig _accessControlConfig = IAccessControlConfig(bookKeeper.accessControlConfig());
    require(_accessControlConfig.hasRole(_accessControlConfig.REINVESTOR_ROLE(), msg.sender), "!reinvestorRole");
    _;
  }

  /// @dev Require that the caller must be an EOA account to avoid flash loans.
  modifier onlyEOA() {
    require(msg.sender == tx.origin, "PancakeswapV2Worker02::onlyEOA:: not eoa");
    _;
  }

  function initialize(
    address _bookKeeper,
    bytes32 _collateralPoolId,
    address _collateralToken,
    address _rewardToken,
    address _masterChef,
    uint256 _pid,
    uint256 _treasuryFeeBps,
    address _treasuryAccount,
    address _positionManager,
    address _router,
    address _baseToken,
    address _addStrat
  ) external initializer {
    // 1. Initialized all dependencies
    PausableUpgradeable.__Pausable_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    // 2. Sanity checks
    (IERC20Upgradeable _stakeToken, , , ) = IPancakeMasterChef(_masterChef).poolInfo(_pid);
    require(address(_stakeToken) == _collateralToken, "LPTokenAutoCompoundAdapter/collateralToken-not-match");
    require(
      IPancakeMasterChef(_masterChef).cake() == _rewardToken,
      "LPTokenAutoCompoundAdapter/reward-token-not-match"
    );
    masterChef = IPancakeMasterChef(_masterChef);
    pid = _pid;

    live = 1;

    bookKeeper = IBookKeeper(_bookKeeper);
    collateralPoolId = _collateralPoolId;
    collateralToken = _collateralToken;
    decimals = IToken(collateralToken).decimals();
    require(decimals <= 18, "LPTokenAutoCompoundAdapter/decimals > 18");

    to18ConversionFactor = 10**(18 - decimals);
    toTokenConversionFactor = 10**decimals;
    rewardToken = _rewardToken;

    require(_treasuryAccount != address(0), "LPTokenAutoCompoundAdapter/bad treasury account");
    treasuryFeeBps = _treasuryFeeBps;
    treasuryAccount = _treasuryAccount;

    positionManager = IManager(_positionManager);

    router = IPancakeRouter02(_router);
    wNative = IPancakeRouter02(_router).WETH();
    baseToken = _baseToken;
    addStrat = ILyfStrategy(_addStrat);

    IPancakePair lpToken = IPancakePair(address(_collateralToken));
    address token0 = lpToken.token0();
    address token1 = lpToken.token1();
    farmingToken = token0 == baseToken ? token1 : token0;

    address(collateralToken).safeApprove(_masterChef, uint256(-1));
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

  /// @dev Set a new reward path. In case that the liquidity of the reward path is changed.
  /// @param _rewardPath The new reward path.
  function setRewardPath(address[] calldata _rewardPath) external onlyOwner {
    require(_rewardPath.length >= 2, "PancakeswapV2Worker02::setRewardPath:: rewardPath length must be >= 2");
    require(
      _rewardPath[0] == rewardToken && _rewardPath[_rewardPath.length - 1] == beneficialVault.token(),
      "PancakeswapV2Worker02::setRewardPath:: rewardPath must start with CAKE and end with beneficialVault token"
    );

    rewardPath = _rewardPath;

    emit LogSetRewardPath(msg.sender, _rewardPath);
  }

  /// @dev Set beneficial vault related data including beneficialVaultBountyBps, beneficialVaultAddress, and rewardPath
  /// @param _beneficialVaultBountyBps - The bounty value to update.
  /// @param _beneficialVault - beneficialVaultAddress
  /// @param _rewardPath - reward token path from rewardToken to beneficialVaultToken
  function setBeneficialVaultConfig(
    uint256 _beneficialVaultBountyBps,
    IAlpacaVault _beneficialVault,
    address[] calldata _rewardPath
  ) external onlyOwner {
    require(
      _beneficialVaultBountyBps <= 10000,
      "LPTokenAutoCompoundAdapter::setBeneficialVaultConfig:: _beneficialVaultBountyBps exceeds 100%"
    );
    require(
      _rewardPath.length >= 2,
      "LPTokenAutoCompoundAdapter::setBeneficialVaultConfig:: rewardPath length must >= 2"
    );
    require(
      _rewardPath[0] == rewardToken && _rewardPath[_rewardPath.length - 1] == _beneficialVault.token(),
      "LPTokenAutoCompoundAdapter::setBeneficialVaultConfig:: rewardPath must start with CAKE, end with beneficialVault token"
    );

    _buyback();

    beneficialVaultBountyBps = _beneficialVaultBountyBps;
    beneficialVault = _beneficialVault;
    rewardPath = _rewardPath;

    emit LogSetBeneficialVaultConfig(msg.sender, _beneficialVaultBountyBps, _beneficialVault, _rewardPath);
  }

  function setTreasuryFeeBps(uint256 _treasuryFeeBps) external onlyOwner {
    require(live == 1, "LPTokenAutoCompoundAdapter/not-live");
    require(_treasuryFeeBps <= 5000, "LPTokenAutoCompoundAdapter/bad treasury fee bps");
    treasuryFeeBps = _treasuryFeeBps;
  }

  function setTreasuryAccount(address _treasuryAccount) external onlyOwner {
    require(live == 1, "LPTokenAutoCompoundAdapter/not-live");
    require(_treasuryAccount != address(0), "LPTokenAutoCompoundAdapter/bad treasury account");
    treasuryAccount = _treasuryAccount;
  }

  /// @dev Ignore collateralTokens that have been directly transferred
  function netAssetValuation() public view returns (uint256 totalBalance) {
    (totalBalance, ) = masterChef.userInfo(pid, address(this));
  }

  /// @dev Return Net Assets per Share in wad
  function netAssetPerShare() public view returns (uint256) {
    if (totalShare == 0) return WAD;
    else return wdiv(netAssetValuation(), totalShare);
  }

  /// @dev for transfering a buyback amount to the particular beneficial vault
  // this will be triggered when beneficialVaultToken equals to baseToken.
  function _buyback() internal {
    if (buybackAmount == 0) return;
    uint256 _buybackAmount = buybackAmount;
    buybackAmount = 0;
    beneficialVault.token().safeTransfer(address(beneficialVault), _buybackAmount);
    emit LogBeneficialVaultTokenBuyback(msg.sender, beneficialVault, _buybackAmount);
  }

  /// @dev Re-invest whatever this worker has earned back to staked LP tokens.
  function reinvest() external onlyEOA onlyReinvestor nonReentrant {
    _reinvest(msg.sender, treasuryFeeBps, 0, 0);
    // in case of beneficial vault equals to operator vault, call buyback to transfer some buyback amount back to the vault
    // This can't be called within the _reinvest statement since _reinvest is called within the `work` as well
    _buyback();
  }

  function _reinvest(
    address _treasuryAccount,
    uint256 _treasuryBountyBps,
    uint256 _callerBalance,
    uint256 _reinvestThreshold
  ) internal {
    require(_treasuryAccount != address(0), "LPTokenAutoCompoundAdapter/bad-treasury-account");
    // 1. Withdraw all the rewards. Return if reward <= _reinvestThreshold.
    masterChef.withdraw(pid, 0);
    uint256 reward = rewardToken.balanceOf(address(this));
    if (reward <= _reinvestThreshold) return;

    // 2. Approve tokens
    rewardToken.safeApprove(address(router), uint256(-1));
    address(collateralToken).safeApprove(address(masterChef), uint256(-1));

    // 3. Send the reward bounty to the _treasuryAccount.
    uint256 bounty = reward.mul(_treasuryBountyBps) / 10000;
    if (bounty > 0) {
      uint256 beneficialVaultBounty = bounty.mul(beneficialVaultBountyBps) / 10000;
      if (beneficialVaultBounty > 0) _rewardToBeneficialVault(beneficialVaultBounty, _callerBalance);
      rewardToken.safeTransfer(_treasuryAccount, bounty.sub(beneficialVaultBounty));
    }

    // 4. Convert all the remaining rewards to BaseToken according to config path.
    router.swapExactTokensForTokens(reward.sub(bounty), 0, getReinvestPath(), address(this), now);

    // 5. Use add Token strategy to convert all BaseToken without both caller balance and buyback amount to LP tokens.
    baseToken.safeTransfer(address(addStrat), actualBaseTokenBalance().sub(_callerBalance));
    addStrat.execute(address(0), 0, abi.encode(0));

    // 6. Stake LPs for more rewards
    masterChef.deposit(pid, collateralToken.balanceOf(address(this)));

    // 7. Reset approval
    rewardToken.safeApprove(address(router), 0);
    collateralToken.safeApprove(address(masterChef), 0);

    emit LogReinvest(_treasuryAccount, reward, bounty);
  }

  /// @dev Internal function to get reinvest path. Return route through WBNB if reinvestPath not set.
  function getReinvestPath() public view returns (address[] memory) {
    if (reinvestPath.length != 0) return reinvestPath;
    address[] memory path;
    if (baseToken == wNative) {
      path = new address[](2);
      path[0] = address(rewardToken);
      path[1] = address(wNative);
    } else {
      path = new address[](3);
      path[0] = address(rewardToken);
      path[1] = address(wNative);
      path[2] = address(baseToken);
    }
    return path;
  }

  /// @dev since buybackAmount variable has been created to collect a buyback balance when during the reinvest within the work method,
  /// thus the actualBaseTokenBalance exists to differentiate an actual base token balance balance without taking buy back amount into account
  function actualBaseTokenBalance() internal view returns (uint256) {
    return baseToken.myBalance().sub(buybackAmount);
  }

  /// @dev Some portion of a bounty from reinvest will be sent to beneficialVault to increase the size of totalToken.
  /// @param _beneficialVaultBounty - The amount of CAKE to be swapped to BTOKEN & send back to the Vault.
  /// @param _callerBalance - The balance that is owned by the msg.sender within the execution scope.
  function _rewardToBeneficialVault(uint256 _beneficialVaultBounty, uint256 _callerBalance) internal {
    /// 1. read base token from beneficialVault
    address beneficialVaultToken = beneficialVault.token();
    /// 2. swap reward token to beneficialVaultToken
    uint256[] memory amounts = router.swapExactTokensForTokens(
      _beneficialVaultBounty,
      0,
      rewardPath,
      address(this),
      now
    );
    /// 3. if beneficialvault token not equal to baseToken regardless of a caller balance, can directly transfer to beneficial vault
    /// otherwise, need to keep it as a buybackAmount,
    /// since beneficial vault is the same as the calling vault, it will think of this reward as a `back` amount to paydebt/ sending back to a position owner
    if (beneficialVaultToken != baseToken) {
      buybackAmount = 0;
      beneficialVaultToken.safeTransfer(address(beneficialVault), beneficialVaultToken.myBalance());
      emit LogBeneficialVaultTokenBuyback(msg.sender, beneficialVault, amounts[amounts.length - 1]);
    } else {
      buybackAmount = beneficialVaultToken.myBalance().sub(_callerBalance);
    }
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
  function _deposit(
    address _positionAddress,
    uint256 _amount,
    bytes calldata /* _data */
  ) private {
    require(live == 1, "LPTokenAutoCompoundAdapter/not live");

    _reinvest(treasuryAccount, treasuryFeeBps, actualBaseTokenBalance(), reinvestThreshold);

    if (_amount > 0) {
      uint256 _share = wdiv(mul(_amount, to18ConversionFactor), netAssetPerShare()); // [wad]
      // Overflow check for int256(wad) cast below
      // Also enforces a non-zero wad
      require(int256(_share) > 0, "LPTokenAutoCompoundAdapter/share-overflow");
      collateralToken.safeTransferFrom(msg.sender, address(this), _amount);
      bookKeeper.addCollateral(collateralPoolId, _positionAddress, int256(_share));
      totalShare = add(totalShare, _share);
      stake[_positionAddress] = add(stake[_positionAddress], _share);

      collateralToken.safeApprove(address(masterChef), _amount);
      masterChef.deposit(pid, _amount);
    }

    emit LogDeposit(_amount);
  }

  /// @dev Harvest and withdraw ibToken from FairLaunch
  /// @param _usr The address that holding states of the position
  /// @param _share The number of share to withdraw
  function withdraw(
    address _usr,
    uint256 _share,
    bytes calldata /* _data */
  ) external override nonReentrant whenNotPaused {
    _reinvest(treasuryAccount, treasuryFeeBps, actualBaseTokenBalance(), reinvestThreshold);
    _withdraw(_usr, _share);
  }

  /// @dev Harvest rewardTokens and distribute to user,
  /// withdraw collateral tokens from staking contract, and update BookKeeper
  /// @param _usr The position address to be updated
  /// @param _share The number of share to withdraw
  function _withdraw(address _usr, uint256 _share) private {
    require(live == 1, "LPTokenAutoCompoundAdapter/not live");
    if (_share > 0) {
      uint256 _amount = _share.mul(netAssetPerShare()).div(1e18); // [wad]

      // Withdraw from MasterChef
      masterChef.withdraw(pid, _amount);

      // Overflow check for int256(wad) cast below
      // Also enforces a non-zero wad
      require(int256(_share) > 0, "LPTokenAutoCompoundAdapter/share-overflow");
      require(stake[msg.sender] >= _share, "LPTokenAutoCompoundAdapter/insufficient staked amount");

      bookKeeper.addCollateral(collateralPoolId, msg.sender, -int256(_share));
      totalShare = sub(totalShare, _share);
      stake[msg.sender] = sub(stake[msg.sender], _share);

      address(collateralToken).safeTransfer(_usr, _amount);
    }
    emit LogWithdraw(_share);
  }

  /// @dev EMERGENCY ONLY. Withdraw ibToken from FairLaunch with invoking "_harvest"
  function emergencyWithdraw(address _to) external nonReentrant {
    if (live == 1) {
      uint256 _amount = bookKeeper.collateralToken(collateralPoolId, msg.sender);
      masterChef.withdraw(pid, _amount);
    }
    _emergencyWithdraw(_to);
  }

  /// @dev EMERGENCY ONLY. Withdraw collateralTokens from staking contract without invoking _harvest
  /// @param _to The address to received collateralTokens
  function _emergencyWithdraw(address _to) private {
    uint256 _share = bookKeeper.collateralToken(collateralPoolId, msg.sender); //[wad]
    require(_share < 2**255, "LPTokenAutoCompoundAdapter/share-overflow");
    uint256 _amount = wmul(wmul(_share, netAssetPerShare()), toTokenConversionFactor);
    bookKeeper.addCollateral(collateralPoolId, msg.sender, -int256(_share));
    totalShare = sub(totalShare, _share);
    stake[msg.sender] = sub(stake[msg.sender], _share);
    address(collateralToken).safeTransfer(_to, _amount);
    emit LogEmergencyWithdraw(msg.sender, _to);
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
  /// @dev access: COLLATERAL_MANAGER_ROLE
  function _moveStake(
    address _source,
    address _destination,
    uint256 _share,
    bytes calldata /* data */
  ) private {
    // This function is not used because we do not allow users to harvest the rewards.
    return;
    emit LogMoveStake(_source, _destination, _share);
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
  /// @dev access: OWNER_ROLE
  function cage() external override nonReentrant {
    // Allow caging if
    // - msg.sender is whitelisted to do so
    // - Shield's owner has been changed
    IAccessControlConfig _accessControlConfig = IAccessControlConfig(bookKeeper.accessControlConfig());
    require(
      _accessControlConfig.hasRole(_accessControlConfig.OWNER_ROLE(), msg.sender),
      "LPTokenAutoCompoundAdapter/not-authorized"
    );
    require(live == 1, "LPTokenAutoCompoundAdapter/not-live");
    masterChef.emergencyWithdraw(pid);
    live = 0;
    emit LogCage();
  }

  /// @dev access: OWNER_ROLE
  function uncage() external override {
    IAccessControlConfig _accessControlConfig = IAccessControlConfig(bookKeeper.accessControlConfig());
    require(
      _accessControlConfig.hasRole(_accessControlConfig.OWNER_ROLE(), msg.sender),
      "LPTokenAutoCompoundAdapter/not-authorized"
    );
    require(live == 0, "LPTokenAutoCompoundAdapter/not-caged");
    masterChef.deposit(pid, totalShare);
    live = 1;
    emit LogUncage();
  }

  // --- pause ---
  /// @dev access: OWNER_ROLE, GOV_ROLE
  function pause() external onlyOwnerOrGov {
    _pause();
  }

  /// @dev access: OWNER_ROLE, GOV_ROLE
  function unpause() external onlyOwnerOrGov {
    _unpause();
  }

  /// @dev access: OWNER_ROLE
  function refreshApproval() external nonReentrant onlyOwner {
    address(collateralToken).safeApprove(address(masterChef), uint256(-1));
  }
}
