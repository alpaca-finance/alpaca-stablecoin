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

contract PCSFlashLiquidator is OwnableUpgradeable, IFlashLendingCallee {
  using SafeToken for address;
  using SafeMathUpgradeable for uint256;

  event LogFlashLiquidation(
    address indexed liquidatorAddress,
    uint256 debtValueToRepay,
    uint256 collateralAmountToLiquidate,
    uint256 liquidationProfit
  );
  event LogSellCollateral(uint256 amount, uint256 minAmountOut, uint256 actualAmountOut);

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
      address[] memory _path
    ) = abi.decode(data, (address, IGenericTokenAdapter, address, IPancakeRouter02, address[]));

    // Retrieve collateral token
    (address _token, uint256 _actualCollateralAmount) = _retrieveCollateral(
      _tokenAdapter,
      _vaultAddress,
      _collateralAmountToLiquidate
    );

    // Swap token to AUSD
    require(
      _debtValueToRepay.div(RAY) + 1 <=
        _sellCollateral(_token, _path, _router, _actualCollateralAmount, _debtValueToRepay),
      "not enough to repay debt"
    );

    // Deposit Alpaca Stablecoin for liquidatorAddress
    uint256 _liquidationProfit = _depositAlpacaStablecoin(_debtValueToRepay.div(RAY) + 1, _liquidatorAddress);
    emit LogFlashLiquidation(_liquidatorAddress, _debtValueToRepay, _collateralAmountToLiquidate, _liquidationProfit);
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
    address[] memory _path,
    IPancakeRouter02 _router,
    uint256 _amount,
    uint256 _minAmountOut
  ) internal returns (uint256 receivedAmount) {
    uint256 _alpacaStablecoinBalanceBefore = alpacaStablecoin.myBalance();
    _token.safeApprove(address(_router), uint256(-1));
    _router.swapExactTokensForTokens(_amount, _minAmountOut.div(RAY) + 1, _path, address(this), now);
    _token.safeApprove(address(_router), 0);
    uint256 _alpacaStablecoinBalanceAfter = alpacaStablecoin.myBalance();
    receivedAmount = _alpacaStablecoinBalanceAfter.sub(_alpacaStablecoinBalanceBefore);
    emit LogSellCollateral(_amount, _minAmountOut, receivedAmount);
  }

  function _depositAlpacaStablecoin(uint256 _amount, address _liquidatorAddress)
    internal
    returns (uint256 _liquidationProfit)
  {
    uint256 balanceBefore = alpacaStablecoin.myBalance();
    alpacaStablecoin.safeApprove(address(stablecoinAdapter), uint256(-1));
    stablecoinAdapter.deposit(_liquidatorAddress, _amount, abi.encode(0));
    alpacaStablecoin.safeApprove(address(stablecoinAdapter), 0);
    _liquidationProfit = balanceBefore.sub(_amount);
  }

  function whitelist(address _toBeWhitelistedAddress) external onlyOwner {
    bookKeeper.whitelist(_toBeWhitelistedAddress);
  }

  function withdrawToken(address _token, uint256 _amount) external onlyOwner {
    _token.safeTransfer(msg.sender, _amount);
  }
}
