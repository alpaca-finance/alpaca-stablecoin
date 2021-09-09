pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@chainlink/contracts/src/v0.6/interfaces/AggregatorV3Interface.sol";

import "../interfaces/IPriceFeed.sol";

contract ChainLinkPriceFeed is OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable, IPriceFeed {
  using SafeMath for uint256;

  AggregatorV3Interface public source;

  // --- Init ---
  function initialize(address _source) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

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

  function peek() external override returns (bytes32, bool) {
    return (_getPrice(), _isPriceFresh());
  }
}
