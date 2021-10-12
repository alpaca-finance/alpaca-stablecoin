// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "../interfaces/IBookKeeper.sol";
import "../interfaces/ICagable.sol";
import "../interfaces/ICollateralPoolConfig.sol";
import "../interfaces/IAccessControlConfig.sol";

/// @title BookKeeper
/// @author Alpaca Fin Corporation
/** @notice A contract which acts as a book keeper of the Alpaca Stablecoin protocol. 
    It has the ability to move collateral token and stablecoin with in the accounting state variable. 
*/

contract BookKeeper is IBookKeeper, PausableUpgradeable, ReentrancyGuardUpgradeable, ICagable {
  struct LocalVar {
    uint256 debtAccumulatedRate; // [ray]
    uint256 totalDebtShare; // [wad]
    uint256 debtCeiling; // [rad]
    uint256 priceWithSafetyMargin; // [ray]
    uint256 debtFloor; // [rad]
  }

  function pause() external {
    require(
      IAccessControlConfig(accessControlConfig).hasRole(
        IAccessControlConfig(accessControlConfig).OWNER_ROLE(),
        msg.sender
      ) || IAccessControlConfig(accessControlConfig).hasRole(keccak256("GOV_ROLE"), msg.sender),
      "!(ownerRole or govRole)"
    );
    _pause();
  }

  function unpause() external {
    require(
      IAccessControlConfig(accessControlConfig).hasRole(
        IAccessControlConfig(accessControlConfig).OWNER_ROLE(),
        msg.sender
      ) || IAccessControlConfig(accessControlConfig).hasRole(keccak256("GOV_ROLE"), msg.sender),
      "!(ownerRole or govRole)"
    );
    _unpause();
  }

  /// @dev This is the mapping which stores the consent or allowance to adjust positions by the position addresses.
  /// @dev `address` The position address
  /// @dev `address` The allowance delegate address
  /// @dev `uint256` true (1) means allowed or false (0) means not allowed
  mapping(address => mapping(address => uint256)) public override positionWhitelist;

  /// @dev Give an allowance to the `usr` address to adjust the position address who is the caller.
  /// @dev `usr` The address to be allowed to adjust position
  function whitelist(address toBeWhitelistedAddress) external override whenNotPaused {
    positionWhitelist[msg.sender][toBeWhitelistedAddress] = 1;
  }

  /// @dev Revoke an allowance from the `usr` address to adjust the position address who is the caller.
  /// @dev `usr` The address to be revoked from adjusting position
  function blacklist(address toBeBlacklistedAddress) external override whenNotPaused {
    positionWhitelist[msg.sender][toBeBlacklistedAddress] = 0;
  }

  /// @dev Check if the `usr` address is allowed to adjust the position address (`bit`).
  /// @param bit The position address
  /// @param usr The address to be checked for permission
  function wish(address bit, address usr) internal view returns (bool) {
    return either(bit == usr, positionWhitelist[bit][usr] == 1);
  }

  // --- Data ---
  struct Position {
    uint256 lockedCollateral; // Locked collateral inside this position (used for minting)                  [wad]
    uint256 debtShare; // The debt share of this position or the share amount of minted Alpaca Stablecoin   [wad]
  }

  mapping(bytes32 => mapping(address => Position)) public override positions; // mapping of all positions by collateral pool id and position address
  mapping(bytes32 => mapping(address => uint256)) public override collateralToken; // the accounting of collateral token which is deposited into the protocol [wad]
  mapping(address => uint256) public override stablecoin; // the accounting of the stablecoin that is deposited or has not been withdrawn from the protocol [rad]
  mapping(address => uint256) public override systemBadDebt; // the bad debt of the system from late liquidation [rad]

  uint256 public override totalStablecoinIssued; // Total stable coin issued or total stalbecoin in circulation   [rad]
  uint256 public totalUnbackedStablecoin; // Total unbacked stable coin  [rad]
  uint256 public totalDebtCeiling; // Total debt ceiling  [rad]
  uint256 public live; // Active Flag
  address public override collateralPoolConfig;
  address public override accessControlConfig;

  // --- Init ---
  function initialize(address _collateralPoolConfig, address _accessControlConfig) external initializer {
    PausableUpgradeable.__Pausable_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    collateralPoolConfig = _collateralPoolConfig;

    accessControlConfig = _accessControlConfig;

    live = 1;
  }

  // --- Math ---
  function add(uint256 x, int256 y) internal pure returns (uint256 z) {
    z = x + uint256(y);
    require(y >= 0 || z <= x);
    require(y <= 0 || z >= x);
  }

  function sub(uint256 x, int256 y) internal pure returns (uint256 z) {
    z = x - uint256(y);
    require(y <= 0 || z <= x);
    require(y >= 0 || z >= x);
  }

  function mul(uint256 x, int256 y) internal pure returns (int256 z) {
    z = int256(x) * y;
    require(int256(x) >= 0);
    require(y == 0 || z / y == int256(x));
  }

  function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x + y) >= x);
  }

  function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x - y) <= x);
  }

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x);
  }

  // --- Administration ---
  event LogSetTotalDebtCeiling(address indexed _caller, uint256 _totalDebtCeiling);
  event LogSetAccessControlConfig(address indexed _caller, address _accessControlConfig);

  function setTotalDebtCeiling(uint256 _totalDebtCeiling) external {
    require(
      IAccessControlConfig(accessControlConfig).hasRole(
        IAccessControlConfig(accessControlConfig).OWNER_ROLE(),
        msg.sender
      ),
      "!ownerRole"
    );
    require(live == 1, "BookKeeper/not-live");
    totalDebtCeiling = _totalDebtCeiling;
    emit LogSetTotalDebtCeiling(msg.sender, _totalDebtCeiling);
  }

  function setAccessControlConfig(address _accessControlConfig) external {
    require(
      IAccessControlConfig(accessControlConfig).hasRole(
        IAccessControlConfig(accessControlConfig).OWNER_ROLE(),
        msg.sender
      ),
      "!ownerRole"
    );

    IAccessControlConfig(_accessControlConfig).hasRole(
      IAccessControlConfig(accessControlConfig).OWNER_ROLE(),
      msg.sender
    ); // Sanity Check Call
    accessControlConfig = _accessControlConfig;

    emit LogSetAccessControlConfig(msg.sender, _accessControlConfig);
  }

  function cage() external override {
    require(
      IAccessControlConfig(accessControlConfig).hasRole(
        IAccessControlConfig(accessControlConfig).OWNER_ROLE(),
        msg.sender
      ) ||
        IAccessControlConfig(accessControlConfig).hasRole(
          IAccessControlConfig(accessControlConfig).SHOW_STOPPER_ROLE(),
          msg.sender
        ),
      "!(ownerRole or showStopperRole)"
    );
    require(live == 1, "BookKeeper/not-live");
    live = 0;

    emit Cage();
  }

  function uncage() external override {
    require(
      IAccessControlConfig(accessControlConfig).hasRole(
        IAccessControlConfig(accessControlConfig).OWNER_ROLE(),
        msg.sender
      ) ||
        IAccessControlConfig(accessControlConfig).hasRole(
          IAccessControlConfig(accessControlConfig).SHOW_STOPPER_ROLE(),
          msg.sender
        ),
      "!(ownerRole or showStopperRole)"
    );
    require(live == 0, "BookKeeper/not-caged");
    live = 1;

    emit Uncage();
  }

  // --- Fungibility ---
  /// @dev Add or remove collateral token balance to an address within the accounting of the protocol
  /// @param collateralPoolId The collateral pool id
  /// @param usr The target address
  /// @param amount The collateral amount in [wad]
  function addCollateral(
    bytes32 collateralPoolId,
    address usr,
    int256 amount
  ) external override nonReentrant whenNotPaused {
    require(
      IAccessControlConfig(accessControlConfig).hasRole(
        IAccessControlConfig(accessControlConfig).ADAPTER_ROLE(),
        msg.sender
      ),
      "!adapterRole"
    );
    collateralToken[collateralPoolId][usr] = add(collateralToken[collateralPoolId][usr], amount);
  }

  /// @dev Move a balance of collateral token from a source address to a destination address within the accounting of the protocol
  /// @param collateralPoolId the collateral pool id
  /// @param src The source address
  /// @param dst The destination address
  /// @param amount The collateral amount in [wad]
  function moveCollateral(
    bytes32 collateralPoolId,
    address src,
    address dst,
    uint256 amount
  ) external override nonReentrant whenNotPaused {
    require(wish(src, msg.sender), "BookKeeper/not-allowed");
    collateralToken[collateralPoolId][src] = sub(collateralToken[collateralPoolId][src], amount);
    collateralToken[collateralPoolId][dst] = add(collateralToken[collateralPoolId][dst], amount);
  }

  /// @dev Move a balance of stablecoin from a source address to a destination address within the accounting of the protocol
  /// @param src The source address
  /// @param dst The destination address
  /// @param value The stablecoin value in [rad]
  function moveStablecoin(
    address src,
    address dst,
    uint256 value
  ) external override nonReentrant whenNotPaused {
    require(wish(src, msg.sender), "BookKeeper/not-allowed");
    stablecoin[src] = sub(stablecoin[src], value);
    stablecoin[dst] = add(stablecoin[dst], value);
  }

  function either(bool x, bool y) internal pure returns (bool z) {
    assembly {
      z := or(x, y)
    }
  }

  function both(bool x, bool y) internal pure returns (bool z) {
    assembly {
      z := and(x, y)
    }
  }

  // --- CDP Manipulation ---
  /// @dev Adjust a position on the target position address to perform locking/unlocking of collateral and minting/repaying of stablecoin
  /// @param collateralPoolId Collateral pool id
  /// @param positionAddress Address of the position
  /// @param collateralOwner The payer/receiver of the collateral token, the collateral token must already be deposited into the protocol in case of locking the collateral
  /// @param stablecoinOwner The payer/receiver of the stablecoin, the stablecoin must already be deposited into the protocol in case of repaying debt
  /// @param collateralValue The value of the collateral to lock/unlock
  /// @param debtShare The debt share of stalbecoin to mint/repay. Please pay attention that this is a debt share not debt value.
  function adjustPosition(
    bytes32 collateralPoolId,
    address positionAddress,
    address collateralOwner,
    address stablecoinOwner,
    int256 collateralValue,
    int256 debtShare
  ) external override nonReentrant whenNotPaused {
    require(
      IAccessControlConfig(accessControlConfig).hasRole(
        IAccessControlConfig(accessControlConfig).POSITION_MANAGER_ROLE(),
        msg.sender
      ),
      "!positionManagerRole"
    );

    // system is live
    require(live == 1, "BookKeeper/not-live");

    Position memory position = positions[collateralPoolId][positionAddress];

    LocalVar memory _vars;
    _vars.debtAccumulatedRate = ICollateralPoolConfig(collateralPoolConfig).getDebtAccumulatedRate(collateralPoolId); // [ray]
    _vars.totalDebtShare = ICollateralPoolConfig(collateralPoolConfig).getTotalDebtShare(collateralPoolId); // [wad]
    _vars.debtCeiling = ICollateralPoolConfig(collateralPoolConfig).getDebtCeiling(collateralPoolId); // [rad]
    _vars.priceWithSafetyMargin = ICollateralPoolConfig(collateralPoolConfig).getPriceWithSafetyMargin(
      collateralPoolId
    ); // [ray]
    _vars.debtFloor = ICollateralPoolConfig(collateralPoolConfig).getDebtFloor(collateralPoolId); // [rad]

    // collateralPool has been initialised
    require(_vars.debtAccumulatedRate != 0, "BookKeeper/collateralPool-not-init");
    position.lockedCollateral = add(position.lockedCollateral, collateralValue);
    position.debtShare = add(position.debtShare, debtShare);
    _vars.totalDebtShare = add(_vars.totalDebtShare, debtShare);
    ICollateralPoolConfig(collateralPoolConfig).setTotalDebtShare(collateralPoolId, _vars.totalDebtShare);

    int256 debtValue = mul(_vars.debtAccumulatedRate, debtShare);
    uint256 positionDebtValue = mul(_vars.debtAccumulatedRate, position.debtShare);
    totalStablecoinIssued = add(totalStablecoinIssued, debtValue);

    // either debt has decreased, or debt ceilings are not exceeded
    require(
      either(
        debtShare <= 0,
        both(
          mul(_vars.totalDebtShare, _vars.debtAccumulatedRate) <= _vars.debtCeiling,
          totalStablecoinIssued <= totalDebtCeiling
        )
      ),
      "BookKeeper/ceiling-exceeded"
    );
    // position is either less risky than before, or it is safe :: check work factor
    require(
      either(
        both(debtShare <= 0, collateralValue >= 0),
        positionDebtValue <= mul(position.lockedCollateral, _vars.priceWithSafetyMargin)
      ),
      "BookKeeper/not-safe"
    );

    // position is either more safe, or the owner consents
    require(
      either(both(debtShare <= 0, collateralValue >= 0), wish(positionAddress, msg.sender)),
      "BookKeeper/not-allowed-position-address"
    );
    // collateral src consents
    require(either(collateralValue <= 0, wish(collateralOwner, msg.sender)), "BookKeeper/not-allowed-collateral-owner");
    // debt dst consents
    require(either(debtShare >= 0, wish(stablecoinOwner, msg.sender)), "BookKeeper/not-allowed-stablecoin-owner");

    // position has no debt, or a non-debtFloory amount
    require(either(position.debtShare == 0, positionDebtValue >= _vars.debtFloor), "BookKeeper/debt-floor");
    collateralToken[collateralPoolId][collateralOwner] = sub(
      collateralToken[collateralPoolId][collateralOwner],
      collateralValue
    );
    stablecoin[stablecoinOwner] = add(stablecoin[stablecoinOwner], debtValue);

    positions[collateralPoolId][positionAddress] = position;
  }

  // --- CDP Fungibility ---
  /// @dev Move the collateral or stablecoin debt inside a position to another position
  /// @param collateralPoolId Collateral pool id
  /// @param src Source address of the position
  /// @param dst Destination address of the position
  /// @param collateralAmount The amount of the locked collateral to be moved
  /// @param debtShare The debt share of stalbecoin to be moved
  function movePosition(
    bytes32 collateralPoolId,
    address src,
    address dst,
    int256 collateralAmount,
    int256 debtShare
  ) external override nonReentrant whenNotPaused {
    require(
      IAccessControlConfig(accessControlConfig).hasRole(
        IAccessControlConfig(accessControlConfig).POSITION_MANAGER_ROLE(),
        msg.sender
      ),
      "!positionManagerRole"
    );

    Position storage _positionSrc = positions[collateralPoolId][src];
    Position storage _positionDst = positions[collateralPoolId][dst];

    LocalVar memory _vars;
    _vars.debtAccumulatedRate = ICollateralPoolConfig(collateralPoolConfig).getDebtAccumulatedRate(collateralPoolId);
    _vars.priceWithSafetyMargin = ICollateralPoolConfig(collateralPoolConfig).getPriceWithSafetyMargin(
      collateralPoolId
    );
    _vars.debtFloor = ICollateralPoolConfig(collateralPoolConfig).getDebtFloor(collateralPoolId);

    _positionSrc.lockedCollateral = sub(_positionSrc.lockedCollateral, collateralAmount);
    _positionSrc.debtShare = sub(_positionSrc.debtShare, debtShare);
    _positionDst.lockedCollateral = add(_positionDst.lockedCollateral, collateralAmount);
    _positionDst.debtShare = add(_positionDst.debtShare, debtShare);

    uint256 utab = mul(_positionSrc.debtShare, _vars.debtAccumulatedRate);
    uint256 vtab = mul(_positionDst.debtShare, _vars.debtAccumulatedRate);

    // both sides consent
    require(both(wish(src, msg.sender), wish(dst, msg.sender)), "BookKeeper/not-allowed");

    // both sides safe
    require(utab <= mul(_positionSrc.lockedCollateral, _vars.priceWithSafetyMargin), "BookKeeper/not-safe-src");
    require(vtab <= mul(_positionDst.lockedCollateral, _vars.priceWithSafetyMargin), "BookKeeper/not-safe-dst");

    // both sides non-debtFloory
    require(either(utab >= _vars.debtFloor, _positionSrc.debtShare == 0), "BookKeeper/debt-floor-src");
    require(either(vtab >= _vars.debtFloor, _positionDst.debtShare == 0), "BookKeeper/debt-floor-dst");
  }

  // --- CDP Confiscation ---
  /** @dev Confiscate position from the owner for the position to be liquidated.
      The position will be confiscated of collateral in which these collateral will be sold through a liquidation process to repay the stablecoin debt.
      The confiscated collateral will be seized by the Auctioneer contracts and will be moved to the corresponding liquidator addresses upon later.
      The stablecoin debt will be mark up on the SystemDebtEngine contract first. This would signify that the system currently has a bad debt of this amount. 
      But it will be cleared later on from a successful liquidation. If this debt is not fully liquidated, the remaining debt will stay inside SystemDebtEngine as bad debt.
  */
  /// @param collateralPoolId Collateral pool id
  /// @param positionAddress The position address
  /// @param collateralCreditor The address which will temporarily own the collateral of the liquidated position; this will always be the Auctioneer
  /// @param stablecoinDebtor The address which will be the one to be in debt for the amount of stablecoin debt of the liquidated position, this will always be the SystemDebtEngine
  /// @param collateralAmount The amount of collateral to be confiscated [wad]
  /// @param debtShare The debt share to be confiscated [wad]
  function confiscatePosition(
    bytes32 collateralPoolId,
    address positionAddress,
    address collateralCreditor,
    address stablecoinDebtor,
    int256 collateralAmount,
    int256 debtShare
  ) external override nonReentrant whenNotPaused {
    require(
      IAccessControlConfig(accessControlConfig).hasRole(
        IAccessControlConfig(accessControlConfig).LIQUIDATION_ENGINE_ROLE(),
        msg.sender
      ),
      "!liquidationEngineRole"
    );

    Position storage position = positions[collateralPoolId][positionAddress];
    LocalVar memory _vars;
    _vars.debtAccumulatedRate = ICollateralPoolConfig(collateralPoolConfig).getDebtAccumulatedRate(collateralPoolId);
    _vars.totalDebtShare = ICollateralPoolConfig(collateralPoolConfig).getTotalDebtShare(collateralPoolId);

    position.lockedCollateral = add(position.lockedCollateral, collateralAmount);
    position.debtShare = add(position.debtShare, debtShare);
    _vars.totalDebtShare = add(_vars.totalDebtShare, debtShare);
    ICollateralPoolConfig(collateralPoolConfig).setTotalDebtShare(collateralPoolId, _vars.totalDebtShare);

    int256 debtValue = mul(_vars.debtAccumulatedRate, debtShare);

    collateralToken[collateralPoolId][collateralCreditor] = sub(
      collateralToken[collateralPoolId][collateralCreditor],
      collateralAmount
    );
    systemBadDebt[stablecoinDebtor] = sub(systemBadDebt[stablecoinDebtor], debtValue);
    totalUnbackedStablecoin = sub(totalUnbackedStablecoin, debtValue);
  }

  // --- Settlement ---
  /** @dev Settle the system bad debt of the caller.
      This function will always be called by the SystemDebtEngine which will be the contract that always incur the system debt.
      By executing this function, the SystemDebtEngine must have enough stablecoin which will come from the Surplus of the protocol.
      A successful `settleSystemBadDebt` would remove the bad debt from the system.
  */
  /// @param value the value of stablecoin to be used to settle bad debt [rad]
  function settleSystemBadDebt(uint256 value) external override nonReentrant whenNotPaused {
    systemBadDebt[msg.sender] = sub(systemBadDebt[msg.sender], value);
    stablecoin[msg.sender] = sub(stablecoin[msg.sender], value);
    totalUnbackedStablecoin = sub(totalUnbackedStablecoin, value);
    totalStablecoinIssued = sub(totalStablecoinIssued, value);
  }

  /// @dev Mint unbacked stablecoin without any collateral to be used for incentives and flash mint.
  /// @param from The address which will be the one who incur bad debt (will always be SystemDebtEngine here)
  /// @param to The address which will receive the minted stablecoin
  /// @param value The value of stablecoin to be minted [rad]
  function mintUnbackedStablecoin(
    address from,
    address to,
    uint256 value
  ) external override nonReentrant whenNotPaused {
    require(
      IAccessControlConfig(accessControlConfig).hasRole(
        IAccessControlConfig(accessControlConfig).MINTABLE_ROLE(),
        msg.sender
      ),
      "!mintableRole"
    );
    systemBadDebt[from] = add(systemBadDebt[from], value);
    stablecoin[to] = add(stablecoin[to], value);
    totalUnbackedStablecoin = add(totalUnbackedStablecoin, value);
    totalStablecoinIssued = add(totalStablecoinIssued, value);
  }

  // --- Rates ---
  /** @dev Accrue stability fee or the mint interest rate.
      This function will always be called only by the StabilityFeeCollector contract.
      `debtAccumulatedRate` of a collateral pool is the exchange rate of the stablecoin minted from that pool (think of it like ibToken price from Lending Vault).
      The higher the `debtAccumulatedRate` means the minter of the stablecoin will beed to pay back the debt with higher amount.
      The point of Stability Fee is to collect a surplus amount from minters and this is technically done by incrementing the `debtAccumulatedRate` overtime.
  */
  /// @param collateralPoolId Collateral pool id
  /// @param stabilityFeeRecipient The address which will receive the surplus from Stability Fee. This will always be SystemDebtEngine who will use the surplus to settle bad debt.
  /// @param debtAccumulatedRate The difference value of `debtAccumulatedRate` which will be added to the current value of `debtAccumulatedRate`. [ray]
  function accrueStabilityFee(
    bytes32 collateralPoolId,
    address stabilityFeeRecipient,
    int256 debtAccumulatedRate
  ) external override nonReentrant whenNotPaused {
    require(
      IAccessControlConfig(accessControlConfig).hasRole(
        IAccessControlConfig(accessControlConfig).STABILITY_FEE_COLLECTOR_ROLE(),
        msg.sender
      ),
      "!stabilityFeeCollectorRole"
    );
    require(live == 1, "BookKeeper/not-live");
    LocalVar memory _vars;
    _vars.debtAccumulatedRate = ICollateralPoolConfig(collateralPoolConfig).getDebtAccumulatedRate(collateralPoolId);
    _vars.totalDebtShare = ICollateralPoolConfig(collateralPoolConfig).getTotalDebtShare(collateralPoolId);

    _vars.debtAccumulatedRate = add(_vars.debtAccumulatedRate, debtAccumulatedRate);
    ICollateralPoolConfig(collateralPoolConfig).setDebtAccumulatedRate(collateralPoolId, _vars.debtAccumulatedRate);
    int256 value = mul(_vars.totalDebtShare, debtAccumulatedRate); // [rad]
    stablecoin[stabilityFeeRecipient] = add(stablecoin[stabilityFeeRecipient], value);
    totalStablecoinIssued = add(totalStablecoinIssued, value);
  }
}
