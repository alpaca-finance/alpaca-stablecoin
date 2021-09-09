pragma solidity 0.6.12;

import "./ProxyWallet.sol";
import "./ProxyWalletCache.sol";

// ProxyWalletFactory
// This factory deploys new proxy instances through build()
// Deployed proxy addresses are logged
contract ProxyWalletFactory {
  event Created(address indexed sender, address indexed owner, address proxy, address cache);
  mapping(address => bool) public isProxy;
  ProxyWalletCache public cache;

  constructor() public {
    cache = new ProxyWalletCache();
  }

  // deploys a new proxy instance
  // sets owner of proxy to caller
  function build() public returns (address payable proxy) {
    proxy = build(msg.sender);
  }

  // deploys a new proxy instance
  // sets custom owner of proxy
  function build(address owner) public returns (address payable proxy) {
    proxy = address(new ProxyWallet(address(cache)));
    emit Created(msg.sender, owner, address(proxy), address(cache));
    ProxyWallet(proxy).setOwner(owner);
    isProxy[proxy] = true;
  }
}
