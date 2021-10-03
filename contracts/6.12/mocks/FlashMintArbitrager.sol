// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract FlashMintArbitrager is {
  constructor(string memory _name, string memory _symbol) public ERC20(_name, _symbol) {}

  function mint(address _to, uint256 _amount) external onlyOwner {
    _mint(_to, _amount);
  }
}
