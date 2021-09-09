pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@chainlink/contracts/src/v0.6/interfaces/AggregatorV3Interface.sol";

import "../interfaces/IPriceFeed.sol";

contract ChainLinkPriceFeed is PausableUpgradeable, AccessControlUpgradeable, IPriceFeed {
  using SafeMath for uint256;

  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;
  AggregatorV3Interface public source;

  // --- Init ---
  function initialize(address _source) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    // Grant the contract deployer OWNER role: it will be able
    // to grant and revoke any roles afterward
    _setupRole(OWNER_ROLE, msg.sender);

    source = AggregatorV3Interface(_source);
  }

  function _getPrice() internal view returns (bytes32) {
    (, int256 answer, , , ) = source.latestRoundData();
    uint256 decimals = source.decimals();
    uint256 price = uint256(answer).mul(1e18) / (10**decimals);

    return bytes32(price);
  }

  function _isPriceFresh() internal view returns (bool) {
    (, , , uint256 lastUpdate, ) = source.latestRoundData();
    uint256 life = 1 days;
    return lastUpdate >= now - life;
  }

  function read() external view override returns (bytes32) {
    return _getPrice();
  }

  function peek() external view override returns (bytes32, bool) {
    return (_getPrice(), _isPriceFresh());
  }
}
