pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IPriceFeed.sol";
import "../interfaces/IVault.sol";

contract IbTokenPriceFeed is OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable, IPriceFeed {
  using SafeMath for uint256;

  IPriceFeed public baseTokenSource;
  IVault public vault;

  // --- Init ---
  function initialize(address _vault, address _baseTokenSource) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    vault = IVault(_vault);
    baseTokenSource = IPriceFeed(_baseTokenSource);
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

  function read() external view override returns (bytes32) {
    return _getPrice();
  }

  function peek() external view override returns (bytes32, bool) {
    return (_getPrice(), _isPriceFresh());
  }
}
