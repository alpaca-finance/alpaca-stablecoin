pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@alpaca-finance/alpaca-contract/contracts/6/protocol/apis/pancake/IPancakeRouter02.sol";

import "../interfaces/IFlashLendingCallee.sol";
import "../interfaces/IGenericTokenAdapter.sol";
import "../interfaces/IBookKeeper.sol";
import "../interfaces/IAlpacaVault.sol";
import "../interfaces/IStableSwapModule.sol";
import "../utils/SafeToken.sol";

contract AlpacaStablecoinFlashLiquidator is OwnableUpgradeable, IFlashLendingCallee {
  using SafeToken for address;
  using SafeMathUpgradeable for uint256;

  IBookKeeper bookKeeper;

  function initialize(address _bookKeeper) external initializer {
    OwnableUpgradeable.__Ownable_init();

    bookKeeper = IBookKeeper(_bookKeeper);
  }

  function flashLendingCall(
    address caller,
    uint256 debtValueToRepay, // [rad]
    uint256 collateralAmountToLiquidate, // [wad]
    bytes calldata data
  ) external override {
    (
      IGenericTokenAdapter tokenAdapter,
      address vaultAddress,
      IPancakeRouter02 router,
      IStableSwapModule stableSwapModule
    ) = abi.decode(data, (IGenericTokenAdapter, address, IPancakeRouter02, IStableSwapModule));
    bookKeeper.whitelist(address(tokenAdapter));
    tokenAdapter.withdraw(address(this), collateralAmountToLiquidate, abi.encode(address(this)));
    if (vaultAddress != address(0)) {
      uint256 vaultBaseTokenBalanceBefore = IAlpacaVault(vaultAddress).token().myBalance();
      IAlpacaVault(vaultAddress).withdraw(collateralAmountToLiquidate);
      uint256 vaultBaseTokenBalanceAfter = IAlpacaVault(vaultAddress).token().myBalance();
      collateralAmountToLiquidate = vaultBaseTokenBalanceAfter.sub(vaultBaseTokenBalanceBefore);
    }
    address stableSwapToken;
    address[] memory path = new address[](2);
    path[0] = IAlpacaVault(vaultAddress).token();
    path[1] = stableSwapToken = address(stableSwapModule.authTokenAdapter().token());
    path[0].safeApprove(address(router), uint256(-1));
    uint256 stableSwapTokenBalanceBefore = stableSwapToken.myBalance();
    router.swapExactTokensForTokens(collateralAmountToLiquidate, 0, path, address(this), now);
    uint256 stableSwapTokenBalanceAfter = stableSwapToken.myBalance();
    stableSwapModule.swap
  }
}
