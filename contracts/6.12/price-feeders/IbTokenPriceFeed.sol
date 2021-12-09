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
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IPriceFeed.sol";
import "../interfaces/IAlpacaOracle.sol";
import "../interfaces/IAccessControlConfig.sol";

contract IbTokenPriceFeed is PausableUpgradeable, AccessControlUpgradeable, IPriceFeed {
  using SafeMathUpgradeable for uint256;

  IAccessControlConfig public accessControlConfig;

  IPriceFeed public ibInBasePriceFeed;
  IPriceFeed public baseInUsdPriceFeed;

  uint16 public timeDelay; // in seconds
  uint64 public lastUpdateTimestamp; // block timestamp

  struct Feed {
    uint128 val;
    uint128 ok;
  }

  Feed currentPrice;
  Feed nextPrice;

  event LogValue(bytes32 val);
  event LogSetTimeDelay(address indexed caller, uint16 newTimeDelay);
  event SetIbInBasePriceFeed(address indexed caller, address newIbInBasePriceFeed);
  event SetBaseInUsdPriceFeed(address indexed caller, address newBaseInUserPriceFeed);

  // --- Init ---
  function initialize(
    address _ibInBasePriceFeed,
    address _baseInUsdPriceFeed,
    address _accessControlConfig,
    uint16 _timeDelay
  ) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    ibInBasePriceFeed = IPriceFeed(_ibInBasePriceFeed);
    baseInUsdPriceFeed = IPriceFeed(_baseInUsdPriceFeed);

    ibInBasePriceFeed.peekPrice();
    baseInUsdPriceFeed.peekPrice();

    accessControlConfig = IAccessControlConfig(_accessControlConfig);

    require(_timeDelay >= 15 minutes && _timeDelay <= 2 days, "IbTokenPriceFeed/time-delay-out-of-bound");
    timeDelay = _timeDelay;

    setPrice();
  }

  modifier onlyOwnerOrGov() {
    require(
      accessControlConfig.hasRole(accessControlConfig.GOV_ROLE(), msg.sender) ||
        accessControlConfig.hasRole(accessControlConfig.OWNER_ROLE(), msg.sender),
      "!(ownerRole or govRole)"
    );
    _;
  }

  // --- Math ---
  function add(uint64 x, uint64 y) internal pure returns (uint64 z) {
    z = x + y;
    require(z >= x);
  }

  /// @dev access: OWNER_ROLE, GOV_ROLE
  function pause() external onlyOwnerOrGov {
    _pause();
  }

  /// @dev access: OWNER_ROLE, GOV_ROLE
  function unpause() external onlyOwnerOrGov {
    _unpause();
  }

  /// @dev access: OWNER_ROLE, GOV_ROLE
  function setTimeDelay(uint16 _newTimeDelay) external onlyOwnerOrGov {
    require(_newTimeDelay >= 15 minutes && _newTimeDelay <= 2 days, "IbTokenPriceFeed/time-delay-out-of-bound");
    timeDelay = _newTimeDelay;
    emit LogSetTimeDelay(_msgSender(), _newTimeDelay);
  }

  /// @dev access: OWNER_ROLE, GOV_ROLE
  function setIbInBasePriceFeed(IPriceFeed _newIbInBasePriceFeed) external onlyOwnerOrGov {
    ibInBasePriceFeed = _newIbInBasePriceFeed;
    IPriceFeed(ibInBasePriceFeed).peekPrice();
    emit SetIbInBasePriceFeed(_msgSender(), address(_newIbInBasePriceFeed));
  }

  /// @dev access: OWNER_ROLE, GOV_ROLE
  function setBaseInUsdPriceFeed(IPriceFeed _newBaseInUsdPriceFeed) external onlyOwnerOrGov {
    baseInUsdPriceFeed = _newBaseInUsdPriceFeed;
    IPriceFeed(baseInUsdPriceFeed).peekPrice();
    emit SetBaseInUsdPriceFeed(_msgSender(), address(_newBaseInUsdPriceFeed));
  }

  function readPrice() external view override returns (bytes32) {
    return (bytes32(uint256(currentPrice.val)));
  }

  function peekPrice() external view override returns (bytes32, bool) {
    return (bytes32(uint256(currentPrice.val)), currentPrice.ok == 1);
  }

  function peekNextPrice() external view returns (bytes32, bool) {
    return (bytes32(uint256(nextPrice.val)), nextPrice.ok == 1);
  }

  function setPrice() public whenNotPaused {
    require(pass(), "IbTokenPriceFeed/time-delay-has-not-passed");
    (bytes32 ibInBasePrice, bool ibInBasePriceOk) = ibInBasePriceFeed.peekPrice();
    (bytes32 baseInUsdPrice, bool baseInUsdPriceOk) = baseInUsdPriceFeed.peekPrice();

    uint256 price = uint256(ibInBasePrice).mul(uint256(baseInUsdPrice)).div(1e18);
    bool ok = ibInBasePriceOk && baseInUsdPriceOk && !paused();

    if (ok) {
      currentPrice = nextPrice;
      nextPrice = Feed(uint128(price), 1);
      lastUpdateTimestamp = getStartOfIntervalTimestamp(block.timestamp);
      emit LogValue(bytes32(uint256(currentPrice.val)));
    }
  }

  function getStartOfIntervalTimestamp(uint256 ts) internal view returns (uint64) {
    require(timeDelay != 0, "IbTokenPriceFeed/time-delay-is-zero");
    return uint64(ts - (ts % timeDelay));
  }

  function pass() public view returns (bool ok) {
    return block.timestamp >= add(lastUpdateTimestamp, timeDelay);
  }
}
