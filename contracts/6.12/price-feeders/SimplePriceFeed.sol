pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IPriceFeed.sol";

// SimplePriceFeed is intended to be used for unit test only
contract SimplePriceFeed is PausableUpgradeable, AccessControlUpgradeable, IPriceFeed {
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;

  uint256 public price;
  uint256 public lastUpdate;
  uint256 public priceLife = 1 days; //[seconds] how old the price is considered stale, default 1 day

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

  event SetPrice(address indexed caller, uint256 price, uint256 indexed lastUpdate);
  event SetPriceLife(address indexed caller, uint256 second);

  function setPrice(uint256 _price) external onlyOwner {
    price = _price;
    lastUpdate = now;
    emit SetPrice(msg.sender, price, lastUpdate);
  }

  function setPriceLife(uint256 _second) external onlyOwner {
    priceLife = _second;
    emit SetPriceLife(msg.sender, _second);
  }

  function pause() external onlyOwner {
    _pause();
  }

  function unpause() external onlyOwner {
    _unpause();
  }

  function readPrice() external view override returns (bytes32) {
    return bytes32(price);
  }

  function peekPrice() external view override returns (bytes32, bool) {
    return (bytes32(price), _isPriceOk());
  }

  function _isPriceFresh() internal view returns (bool) {
    // solhint-disable not-rely-on-time
    return lastUpdate >= now - priceLife;
  }

  function _isPriceOk() internal view returns (bool) {
    return _isPriceFresh() && !paused();
  }
}
