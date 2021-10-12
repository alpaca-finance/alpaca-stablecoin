pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IPriceFeed.sol";
import "../interfaces/IAlpacaOracle.sol";

contract IbTokenPriceFeed is PausableUpgradeable, AccessControlUpgradeable, IPriceFeed {
  using SafeMathUpgradeable for uint256;

  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;

  IAlpacaOracle public alpacaOracle;
  address public token0;
  address public token1;
  uint256 public priceLife; // [seconds] how old the price is considered stale, default 1 day

  IPriceFeed ibInBasePriceFeed;
  IPriceFeed baseInUsdPriceFeed;

  // --- Init ---
  function initialize(address _ibInBasePriceFeed, address _baseInUsdPriceFeed) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    // Grant the contract deployer OWNER role: it will be able
    // to grant and revoke any roles afterward
    _setupRole(OWNER_ROLE, msg.sender);

    ibInBasePriceFeed = IPriceFeed(_ibInBasePriceFeed);
    baseInUsdPriceFeed = IPriceFeed(_baseInUsdPriceFeed);
  }

  modifier onlyOwner() {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    _;
  }

  function pause() external onlyOwner {
    _pause();
  }

  function unpause() external onlyOwner {
    _unpause();
  }

  function readPrice() external view override returns (bytes32) {
    bytes32 ibInBasePrice = ibInBasePriceFeed.readPrice();
    bytes32 baseInUsdPrice = baseInUsdPriceFeed.readPrice();

    uint256 price = uint256(ibInBasePrice).mul(uint256(baseInUsdPrice)).div(1e18);
    return bytes32(price);
  }

  function peekPrice() external view override returns (bytes32, bool) {
    (bytes32 ibInBasePrice, bool ibInBasePriceOk) = ibInBasePriceFeed.peekPrice();
    (bytes32 baseInUsdPrice, bool baseInUsdPriceOk) = baseInUsdPriceFeed.peekPrice();

    uint256 price = uint256(ibInBasePrice).mul(uint256(baseInUsdPrice)).div(1e18);
    return (bytes32(price), ibInBasePriceOk && baseInUsdPriceOk && !paused());
  }
}
