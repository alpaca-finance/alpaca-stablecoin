pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@alpaca-finance/alpaca-contract/contracts/6/protocol/apis/pancake/IPancakeRouter02.sol";

import "../interfaces/IFlashLendingCallee.sol";
import "../interfaces/IGenericTokenAdapter.sol";
import "../interfaces/IBookKeeper.sol";
import "../interfaces/IAlpacaVault.sol";
import "../interfaces/IStableSwapModule.sol";
import "../interfaces/IStablecoinAdapter.sol";
import "../utils/SafeToken.sol";

contract AlpacaStablecoinFlashLiquidator is OwnableUpgradeable, IFlashLendingCallee {
  using SafeToken for address;
  using SafeMathUpgradeable for uint256;

  // --- Math ---
  uint256 constant WAD = 10**18;
  uint256 constant RAY = 10**27;
  uint256 constant RAD = 10**45;

  IBookKeeper public bookKeeper;
  IStablecoinAdapter public stablecoinAdapter;
  address public alpacaStablecoin;

  function initialize(
    address _bookKeeper,
    address _alpacaStablecoin,
    address _stablecoinAdapter
  ) external initializer {
    OwnableUpgradeable.__Ownable_init();

    bookKeeper = IBookKeeper(_bookKeeper);
    alpacaStablecoin = _alpacaStablecoin;
    stablecoinAdapter = IStablecoinAdapter(_stablecoinAdapter);
  }

  function flashLendingCall(
    address _caller,
    uint256 _debtValueToRepay, // [rad]
    uint256 _collateralAmountToLiquidate, // [wad]
    bytes calldata data
  ) external override {
    (
      address _liquidatorAddress,
      IGenericTokenAdapter _tokenAdapter,
      address _vaultAddress,
      IPancakeRouter02 _router,
      IStableSwapModule _stableSwapModule
    ) = abi.decode(data, (address, IGenericTokenAdapter, address, IPancakeRouter02, IStableSwapModule));

    // Retrieve collateral token
    (address _token, uint256 _actualCollateralAmount) = _retrieveCollateral(
      _tokenAdapter,
      _vaultAddress,
      _collateralAmountToLiquidate
    );

    // Dump collateral token to DEX for BUSD
    // Swap BUSD to AUSD
    uint256 _alpacaStablecoinBalance = _sellCollateral(_token, _stableSwapModule, _router, _actualCollateralAmount);

    require(_debtValueToRepay.div(RAY) <= _alpacaStablecoinBalance, "not enough to repay debt");

    // Deposit Alpaca Stablecoin for liquidatorAddress
    _depositAlpacaStablecoin(_debtValueToRepay.div(RAY), _liquidatorAddress);
  }

  function _retrieveCollateral(
    IGenericTokenAdapter _tokenAdapter,
    address _vaultAddress,
    uint256 _amount
  ) internal returns (address _token, uint256 _actualAmount) {
    bookKeeper.whitelist(address(_tokenAdapter));
    _tokenAdapter.withdraw(address(this), _amount, abi.encode(address(this)));
    _token = _tokenAdapter.collateralToken();
    _actualAmount = _amount;
    if (_vaultAddress != address(0)) {
      uint256 vaultBaseTokenBalanceBefore = IAlpacaVault(_vaultAddress).token().myBalance();
      IAlpacaVault(_vaultAddress).withdraw(_amount);
      uint256 vaultBaseTokenBalanceAfter = IAlpacaVault(_vaultAddress).token().myBalance();
      _actualAmount = vaultBaseTokenBalanceAfter.sub(vaultBaseTokenBalanceBefore);
      _token = IAlpacaVault(_vaultAddress).token();
    }
  }

  function _sellCollateral(
    address _token,
    IStableSwapModule _stableSwapModule,
    IPancakeRouter02 _router,
    uint256 _amount
  ) internal returns (uint256 receivedAmount) {
    address _stableSwapToken;
    address[] memory path = new address[](2);
    path[0] = _token;
    path[1] = _stableSwapToken = address(_stableSwapModule.authTokenAdapter().token());
    _token.safeApprove(address(_router), uint256(-1));
    uint256 _stableSwapTokenBalanceBefore = _stableSwapToken.myBalance();
    _router.swapExactTokensForTokens(_amount, 0, path, address(this), now);
    uint256 _stableSwapTokenBalanceAfter = _stableSwapToken.myBalance();
    _token.safeApprove(address(_router), 0);
    receivedAmount = _stableSwapTokenBalanceAfter.sub(_stableSwapTokenBalanceBefore);
  }

  function _depositAlpacaStablecoin(uint256 _amount, address _liquidatorAddress) internal {
    alpacaStablecoin.safeApprove(address(stablecoinAdapter), uint256(-1));
    stablecoinAdapter.deposit(_liquidatorAddress, _amount, abi.encode(0));
    alpacaStablecoin.safeApprove(address(stablecoinAdapter), 0);
  }
}
