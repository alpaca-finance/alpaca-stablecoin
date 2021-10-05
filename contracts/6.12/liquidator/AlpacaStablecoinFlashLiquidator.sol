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

  // --- Math ---
  uint256 constant WAD = 10**18;
  uint256 constant RAY = 10**27;
  uint256 constant RAD = 10**45;

  IBookKeeper public bookKeeper;
  address public alpacaStablecoin;

  function initialize(address _bookKeeper, address _alpacaStablecoin) external initializer {
    OwnableUpgradeable.__Ownable_init();

    bookKeeper = IBookKeeper(_bookKeeper);
    alpacaStablecoin = _alpacaStablecoin;
  }

  function flashLendingCall(
    address caller,
    uint256 debtValueToRepay, // [rad]
    uint256 collateralAmountToLiquidate, // [wad]
    bytes calldata data
  ) external override {
    (
      address liquidatorAddress,
      IGenericTokenAdapter tokenAdapter,
      address vaultAddress,
      IPancakeRouter02 router,
      IStableSwapModule stableSwapModule
    ) = abi.decode(data, (address, IGenericTokenAdapter, address, IPancakeRouter02, IStableSwapModule));

    // Retrieve collateral token
    bookKeeper.whitelist(address(tokenAdapter));
    tokenAdapter.withdraw(address(this), collateralAmountToLiquidate, abi.encode(address(this)));
    address token = tokenAdapter.collateralToken();
    if (vaultAddress != address(0)) {
      uint256 vaultBaseTokenBalanceBefore = IAlpacaVault(vaultAddress).token().myBalance();
      IAlpacaVault(vaultAddress).withdraw(collateralAmountToLiquidate);
      uint256 vaultBaseTokenBalanceAfter = IAlpacaVault(vaultAddress).token().myBalance();
      collateralAmountToLiquidate = vaultBaseTokenBalanceAfter.sub(vaultBaseTokenBalanceBefore);
      token = IAlpacaVault(vaultAddress).token();
    }

    // Dump collateral token to DEX for BUSD
    address stableSwapToken;
    address[] memory path = new address[](2);
    path[0] = token;
    path[1] = stableSwapToken = address(stableSwapModule.authTokenAdapter().token());
    token.safeApprove(address(router), uint256(-1));
    uint256 stableSwapTokenBalanceBefore = stableSwapToken.myBalance();
    router.swapExactTokensForTokens(collateralAmountToLiquidate, 0, path, address(this), now);
    uint256 stableSwapTokenBalanceAfter = stableSwapToken.myBalance();

    // Swap BUSD to AUSD
    token.safeApprove(address(stableSwapModule.authTokenAdapter()), uint256(-1));
    uint256 _alpacaStablecoinBalanceBefore = alpacaStablecoin.myBalance();
    stableSwapModule.swapTokenToStablecoin(
      address(this),
      stableSwapTokenBalanceAfter.sub(stableSwapTokenBalanceBefore)
    );
    uint256 _alpacaStablecoinBalanceAfter = alpacaStablecoin.myBalance();

    require();
  }
}
