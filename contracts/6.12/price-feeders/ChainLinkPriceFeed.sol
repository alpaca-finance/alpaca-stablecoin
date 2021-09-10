pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@chainlink/contracts/src/v0.6/interfaces/AggregatorV3Interface.sol";

import "../interfaces/IPriceFeed.sol";

contract ChainLinkPriceFeed is PausableUpgradeable, AccessControlUpgradeable, IPriceFeed {
  using SafeMath for uint256;

  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;
  AggregatorV3Interface public source;
  uint256 public priceLife = 24; // [hour] how old the price is considered stale.

  // --- Init ---
  function initialize(address _source) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    // Grant the contract deployer OWNER role: it will be able
    // to grant and revoke any roles afterward
    _setupRole(OWNER_ROLE, msg.sender);

    source = AggregatorV3Interface(_source);
  }

  modifier onlyOwner() {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    _;
  }

  event SetPriceLife(address indexed caller, uint256 hour);
  event SetPriceSource(address indexed caller, address source);

  function setPriceLife(uint256 _hour) external onlyOwner {
    priceLife = _hour * 1 hours;
    emit SetPriceLife(msg.sender, _hour);
  }

  function setPriceSource(address _source) external onlyOwner {
    source = AggregatorV3Interface(_source);
    emit SetPriceSource(msg.sender, _source);
  }

  function pause() external {
    _pause();
  }

  function unpause() external {
    _unpause();
  }

  function read() external view override returns (bytes32) {
    return _getPrice();
  }

  function peek() external view override returns (bytes32, bool) {
    return (_getPrice(), _isPriceOk());
  }

  function _getPrice() internal view returns (bytes32) {
    (, int256 answer, , , ) = source.latestRoundData();
    uint256 decimals = source.decimals();
    uint256 price = uint256(answer).mul(1e18) / (10**decimals);

    return bytes32(price);
  }

  function _isPriceFresh() internal view returns (bool) {
    (, , , uint256 lastUpdate, ) = source.latestRoundData();
    return lastUpdate >= now - priceLife;
  }

  function _isPriceOk() internal view returns (bool) {
    return _isPriceFresh() && !paused();
  }
}