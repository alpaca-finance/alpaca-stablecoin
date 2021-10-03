// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@pancakeswap/pancake-swap-periphery/contracts/interfaces/IPancakeRouter02.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IERC3156FlashBorrower.sol";
import "../interfaces/IStableSwapModule.sol";

contract FlashMintArbitrager is OwnableUpgradeable, IERC3156FlashBorrower {
  using SafeMathUpgradeable for uint256;

  function onFlashLoan(
    address initiator,
    address token,
    uint256 amount,
    uint256 fee,
    bytes calldata data
  ) external override returns (bytes32) {
    (address router, address stableSwapToken, address stableSwapModule) = abi.decode(data, (address, address, address));
    address[] memory path = new address[](2);
    path[0] = token;
    path[1] = stableSwapToken;

    // 1. Swap AUSD to BUSD at a DEX
    uint256 balanceBefore = IERC20(stableSwapToken).balanceOf(address(this));
    IPancakeRouter02(router).swapExactTokensForTokens(amount, 0, path, address(this), now);
    uint256 balanceAfter = IERC20(stableSwapToken).balanceOf(address(this));

    // 2. Swap BUSD to AUSD at StableSwapModule
    IStableSwapModule(stableSwapModule).swapTokenForStablecoin(address(this), balanceAfter.sub(balanceBefore));

    // 3. Approve AUSD for FlashMintModule
    IERC20(token).approve(initiator, amount.add(fee));
  }
}
