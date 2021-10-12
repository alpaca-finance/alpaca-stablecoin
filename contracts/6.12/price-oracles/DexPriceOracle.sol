pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@alpaca-finance/alpaca-contract/contracts/6/protocol/apis/pancakeV2/PancakeLibraryV2.sol";
import "../interfaces/IAlpacaOracle.sol";

contract SimpleDexPriceOracle is PausableUpgradeable, AccessControlUpgradeable, IAlpacaOracle {
  address dexFactory;

  struct PriceData {
    uint192 price;
    uint64 lastUpdate;
  }

  function initialize(address _dexFactory) external initializer {
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    dexFactory = _dexFactory;
  }

  /// @dev Return the wad price of token0/token1, multiplied by 1e18
  /// NOTE: (if you have 1 token0 how much you can sell it for token1)
  function getPrice(address token0, address token1) external view override returns (uint256 price, uint256 lastUpdate) {
    if (token0 == token1) return (1e18, uint64(now));

    (uint256 r0, uint256 r1) = PancakeLibraryV2.getReserves(dexFactory, token0, token1);
    uint256 price = r1.mul(1e18).div(r0);
    return (price, uint64(now));
  }
}
