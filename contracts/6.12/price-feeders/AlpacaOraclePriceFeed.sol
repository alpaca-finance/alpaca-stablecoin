pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IPriceFeed.sol";
import "../interfaces/IAlpacaOracle.sol";

contract AlpacaOraclePriceFeed is PausableUpgradeable, AccessControlUpgradeable, IPriceFeed {
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;

  IAlpacaOracle public alpacaPriceOracle;
  address public token0;
  address public token1;
  uint256 public priceLife = 1 days; //[seconds] how old the price is considered stale, default 1 day

  // --- Init ---
  function initialize(
    address _alpacaPriceOracle,
    address _token0,
    address _token1
  ) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    // Grant the contract deployer OWNER role: it will be able
    // to grant and revoke any roles afterward
    _setupRole(OWNER_ROLE, msg.sender);

    alpacaPriceOracle = IAlpacaOracle(_alpacaPriceOracle);
    token0 = _token0;
    token1 = _token1;
  }

  modifier onlyOwner() {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    _;
  }

  event SetPriceLife(address indexed caller, uint256 second);

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

  function read() external view override returns (bytes32) {
    return _getPrice();
  }

  function peek() external view override returns (bytes32, bool) {
    return (_getPrice(), _isPriceOk());
  }

  function _getPrice() internal view returns (bytes32) {
    (uint256 price, ) = alpacaPriceOracle.getPrice(token0, token1);
    return bytes32(price);
  }

  function _isPriceFresh() internal view returns (bool) {
    (, uint256 lastUpdate) = alpacaPriceOracle.getPrice(token0, token1);

    // solhint-disable not-rely-on-time
    return lastUpdate >= now - priceLife;
  }

  function _isPriceOk() internal view returns (bool) {
    return _isPriceFresh() && !paused();
  }
}
