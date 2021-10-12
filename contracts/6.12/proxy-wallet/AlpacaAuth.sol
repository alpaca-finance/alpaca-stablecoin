// SPDX-License-Identifier: GNU-3
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity 0.6.12;

import "../interfaces/IAuth.sol";

contract AlpacaAuthEvents {
  event LogSetAuthority(address indexed _authority);
  event LogSetOwner(address indexed _owner);
}

contract AlpacaAuth is AlpacaAuthEvents {
  IAuthority public authority;
  address public owner;

  constructor() public {
    owner = msg.sender;
    emit LogSetOwner(msg.sender);
  }

  function setOwner(address _owner) public auth {
    owner = _owner;
    emit LogSetOwner(owner);
  }

  function setAuthority(IAuthority _authority) public auth {
    authority = _authority;
    emit LogSetAuthority(address(authority));
  }

  modifier auth() {
    require(isAuthorized(msg.sender, msg.sig), "alpaca-auth-unauthorized");
    _;
  }

  function isAuthorized(address _src, bytes4 _sig) internal view returns (bool) {
    if (_src == address(this)) {
      return true;
    } else if (_src == owner) {
      return true;
    } else if (address(authority) == address(0)) {
      return false;
    } else {
      return authority.canCall(_src, address(this), _sig);
    }
  }
}
