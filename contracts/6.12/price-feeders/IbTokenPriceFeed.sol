pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IPriceFeed.sol";
import "../interfaces/IVault.sol";

contract IbTokenPriceFeed is PausableUpgradeable, AccessControlUpgradeable, IPriceFeed {
  using SafeMath for uint256;
  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;

  IPriceFeed public baseTokenSource;
  IVault public vault;

  // --- Init ---
  function initialize(address _vault, address _baseTokenSource) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    // Grant the contract deployer OWNER role: it will be able
    // to grant and revoke any roles afterward
    _setupRole(OWNER_ROLE, msg.sender);

    vault = IVault(_vault);
    baseTokenSource = IPriceFeed(_baseTokenSource);
  }

  modifier onlyOwner() {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    _;
  }

  event SetVault(address indexed caller, address vault);
  event SetBaseTokenSource(address indexed caller, address source);

  function setVault(address _vault) external onlyOwner {
    vault = IVault(_vault);
    emit SetVault(msg.sender, _vault);
  }

  function setBaseTokenSource(address _source) external onlyOwner {
    baseTokenSource = IPriceFeed(_source);
    emit SetBaseTokenSource(msg.sender, _source);
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
    uint256 baseTokenPrice = uint256(baseTokenSource.read());
    uint256 price = baseTokenPrice.mul(vault.totalSupply()) / vault.totalToken();

    return bytes32(price);
  }

  function _isPriceFresh() internal view returns (bool) {
    (, bool isFresh) = baseTokenSource.peek();
    return isFresh;
  }

  function _isPriceOk() internal view returns (bool) {
    return _isPriceFresh() && !paused();
  }
}
