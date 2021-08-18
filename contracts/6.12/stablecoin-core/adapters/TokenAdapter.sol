// SPDX-License-Identifier: AGPL-3.0-or-later

/// deposit.sol -- Basic token adapters

// Copyright (C) 2018 Rain <rainbreak@riseup.net>
//
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
<<<<<<< HEAD
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
=======
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
>>>>>>> 88541bf76077d92f2178413b09354180fe1282f7

// FIXME: This contract was altered compared to the production version.
// It doesn't use LibNote anymore.
// New deployments of this contract will need to include custom events (TO DO).

interface TokenLike {
  function decimals() external view returns (uint256);

  function transfer(address, uint256) external returns (bool);

  function transferFrom(
    address,
    address,
    uint256
  ) external returns (bool);
}

interface StablecoinLike {
  function mint(address, uint256) external;

  function burn(address, uint256) external;
}

interface GovernmentLike {
  function addCollateral(
    bytes32,
    address,
    int256
  ) external;

  function moveStablecoin(
    address,
    address,
    uint256
  ) external;
}

/*
    Here we provide *adapters* to connect the Government to arbitrary external
    token implementations, creating a bounded context for the Government. The
    adapters here are provided as working examples:

      - `TokenAdapter`: For well behaved ERC20 tokens, with simple transfer
                   semantics.

      - `ETHJoin`: For native Ether.

      - `StablecoinAdapter`: For connecting internal Dai balances to an external
                   `DSToken` implementation.

    In practice, adapter implementations will be varied and specific to
    individual collateral types, accounting for different transfer
    semantics and token standards.

    Adapters need to implement two basic methods:

      - `deposit`: enter collateral into the system
      - `withdraw`: remove collateral from the system

*/

<<<<<<< HEAD
contract TokenAdapter is OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable {
  using SafeERC20Upgradeable for address;

=======
contract TokenAdapter is OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable, ReentrancyGuardUpgradeable {
>>>>>>> 88541bf76077d92f2178413b09354180fe1282f7
  // --- Auth ---
  mapping(address => uint256) public wards;

  function rely(address usr) external auth {
    wards[usr] = 1;
  }

  function deny(address usr) external auth {
    wards[usr] = 0;
  }

  modifier auth {
    require(wards[msg.sender] == 1, "TokenAdapter/not-authorized");
    _;
  }

  GovernmentLike public government; // CDP Engine
  bytes32 public collateralPoolId; // Collateral Type
  TokenLike public collateralToken;
  uint256 public decimals;
  uint256 public live; // Active Flag

  function initialize(
    address government_,
    bytes32 collateralPoolId_,
    address collateralToken_
  ) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    wards[msg.sender] = 1;
    live = 1;
    government = GovernmentLike(government_);
    collateralPoolId = collateralPoolId_;
    collateralToken = TokenLike(collateralToken_);
    decimals = collateralToken.decimals();
  }

  function cage() external auth {
    live = 0;
  }

  function deposit(address usr, uint256 wad) external nonReentrant {
    require(live == 1, "TokenAdapter/not-live");
    require(int256(wad) >= 0, "TokenAdapter/overflow");
    government.addCollateral(collateralPoolId, usr, int256(wad));
    IERC20Upgradeable(usr).transferFrom(msg.sender, address(this), wad);
  }

  function withdraw(address usr, uint256 wad) external nonReentrant {
    require(wad <= 2**255, "TokenAdapter/overflow");
    government.addCollateral(collateralPoolId, msg.sender, -int256(wad));
    SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(usr), usr, wad);
  }
}
