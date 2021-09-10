pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IPriceFeed.sol";
import "../interfaces/IVault.sol";
import "../utils/UintArrayUtil.sol";

contract MedianPriceFeed is PausableUpgradeable, AccessControlUpgradeable, IPriceFeed {
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;

  IPriceFeed[] public sources;
  uint256 public maxSourceCount = 3;

  // --- Init ---
  function initialize() external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    // Grant the contract deployer OWNER role: it will be able
    // to grant and revoke any roles afterward
    _setupRole(OWNER_ROLE, msg.sender);
  }

  modifier onlyOwner() {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    _;
  }

  event SetSources(address indexed caller, address[] sources);
  event SetMaxSourceCount(address indexed caller, uint256 maxSourceCount);

  function setSources(address[] memory _sources) external onlyOwner {
    require(_sources.length <= maxSourceCount, "maxSourceCount exceeds");

    // reset sources array
    sources = new IPriceFeed[](_sources.length);

    for (uint256 i = 0; i < _sources.length; i++) {
      sources[i] = IPriceFeed(_sources[i]);
    }
    emit SetSources(msg.sender, _sources);
  }

  function setBaseTokenSource(uint256 _maxSourceCount) external onlyOwner {
    maxSourceCount = _maxSourceCount;
    emit SetMaxSourceCount(msg.sender, maxSourceCount);
  }

  function pause() external onlyOwner {
    _pause();
  }

  function unpause() external onlyOwner {
    _unpause();
  }

  function read() external view override returns (bytes32) {
    (bytes32 price, ) = _computePrice();
    return price;
  }

  function peek() external view override returns (bytes32, bool) {
    (bytes32 price, bool ok) = _computePrice();

    return (price, ok && !paused());
  }

  function _computePrice() internal view returns (bytes32, bool) {
    uint256[] memory prices = _getOkPrices();
    if (prices.length == 0) {
      return (bytes32(0), false);
    }
    uint256 medianPrice = UintArrayUtil.median(prices, prices.length);

    return (bytes32(medianPrice), true);
  }

  function _getOkPrices() internal view returns (uint256[] memory) {
    uint256[] memory prices = new uint256[](sources.length);
    uint256 okIndex = 0;

    for (uint256 i = 0; i < sources.length; i++) {
      (bytes32 price, bool ok) = _peekSourceAt(i);
      if (ok) {
        prices[okIndex++] = uint256(price);
      }
    }

    uint256[] memory okPrices = new uint256[](okIndex);
    for (uint256 i = 0; i < sources.length; i++) {
      okPrices[i] = prices[i];
    }

    return (okPrices);
  }

  function _peekSourceAt(uint256 okIndex) internal view returns (bytes32, bool) {
    IPriceFeed source = sources[okIndex];
    if (address(source) == address(0)) {
      return (bytes32(0), false);
    }

    return source.peek();
  }
}
