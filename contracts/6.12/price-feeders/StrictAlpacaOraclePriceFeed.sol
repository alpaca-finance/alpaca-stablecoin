pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

import "../interfaces/IPriceFeed.sol";
import "../interfaces/IAlpacaOracle.sol";

contract StrictAlpacaOraclePriceFeed is PausableUpgradeable, AccessControlUpgradeable, IPriceFeed {
  using SafeMathUpgradeable for uint256;

  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;

  IAlpacaOracle public alpacaOracleA;
  IAlpacaOracle public alpacaOracleB;
  address public token0;
  address public token1;
  uint256 public priceLife; // [seconds] how old the price is considered stale, default 1 day
  uint256 public maxPriceDiff; // [basis point] ie. 5% diff = 10500 (105%)

  // --- Init ---
  function initialize(
    address _alpacaOracleA,
    address _alpacaOracleB,
    address _token0,
    address _token1
  ) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    // Grant the contract deployer OWNER role: it will be able
    // to grant and revoke any roles afterward
    _setupRole(OWNER_ROLE, msg.sender);

    alpacaOracleA = IAlpacaOracle(_alpacaOracleA);
    alpacaOracleB = IAlpacaOracle(_alpacaOracleB);
    token0 = _token0;
    token1 = _token1;
    priceLife = 1 days;
    maxPriceDiff = 10500;
  }

  modifier onlyOwner() {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    _;
  }

  event LogSetPriceLife(address indexed caller, uint256 second);
  event LogSetMaxPriceDiff(address indexed caller, uint256 maxPriceDiff);

  function setPriceLife(uint256 _second) external onlyOwner {
    priceLife = _second;
    emit LogSetPriceLife(msg.sender, _second);
  }

  function setMaxPriceDiff(uint256 _maxPriceDiff) external onlyOwner {
    maxPriceDiff = _maxPriceDiff;
    emit LogSetMaxPriceDiff(msg.sender, _maxPriceDiff);
  }

  function pause() external onlyOwner {
    _pause();
  }

  function unpause() external onlyOwner {
    _unpause();
  }

  function readPrice() external view override returns (bytes32) {
    (uint256 price, ) = alpacaOracleA.getPrice(token0, token1);
    return bytes32(price);
  }

  function peekPrice() external view override returns (bytes32, bool) {
    (uint256 priceA, uint256 lastUpdateA) = alpacaOracleA.getPrice(token0, token1);
    (uint256 priceB, uint256 lastUpdateB) = alpacaOracleB.getPrice(token0, token1);

    return (bytes32(priceA), _isPriceOk(priceA, priceB, lastUpdateA, lastUpdateB));
  }

  function _isPriceOk(
    uint256 priceA,
    uint256 priceB,
    uint256 lastUpdateA,
    uint256 lastUpdateB
  ) internal view returns (bool) {
    return _isPriceFresh(lastUpdateA, lastUpdateB) && _isPriceStable(priceA, priceB) && !paused();
  }

  function _isPriceFresh(uint256 lastUpdateA, uint256 lastUpdateB) internal view returns (bool) {
    // solhint-disable not-rely-on-time
    return lastUpdateA >= now - priceLife && lastUpdateB >= now - priceLife;
  }

  function _isPriceStable(uint256 priceA, uint256 priceB) internal view returns (bool) {
    return
      // price too high
      priceA.mul(10000) <= priceB.mul(maxPriceDiff) &&
      // price too low
      priceA.mul(maxPriceDiff) >= priceB.mul(10000);
  }
}
