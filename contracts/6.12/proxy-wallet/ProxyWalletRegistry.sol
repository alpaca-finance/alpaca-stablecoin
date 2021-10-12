// SPDX-License-Identifier: AGPL-3.0-or-later

/// ProxyWalletRegistry.sol

// Copyright (C) 2018-2021 Dai Foundation

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "./ProxyWallet.sol";
import "./ProxyWalletFactory.sol";

// This Registry deploys new proxy instances through ProxyWalletFactory.build(address) and keeps a registry of owner => proxy
contract ProxyWalletRegistry is OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable {
  mapping(address => ProxyWallet) public proxies;
  ProxyWalletFactory factory;

  // --- Init ---
  function initialize(address _factory) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();

    factory = ProxyWalletFactory(_factory);
  }

  // deploys a new proxy instance
  // sets owner of proxy to caller
  function build() public returns (address payable _proxy) {
    _proxy = build(msg.sender);
  }

  // deploys a new proxy instance
  // sets custom owner of proxy
  function build(address owner) public returns (address payable _proxy) {
    require(proxies[owner] == ProxyWallet(0)); // Not allow new proxy if the user already has one
    _proxy = factory.build(owner);
    proxies[owner] = ProxyWallet(_proxy);
  }

  function setOwner(address _newOwner) public {
    require(proxies[_newOwner] == ProxyWallet(0));
    ProxyWallet _proxy = proxies[msg.sender];
    require(_proxy.owner() == _newOwner);
    proxies[_newOwner] = _proxy;
    proxies[msg.sender] = ProxyWallet(0);
  }
}
