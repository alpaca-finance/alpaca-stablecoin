// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021 Dai Foundation
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

interface GovernmentLike {
    function live() external view returns (uint256);
    function positions(bytes32, address) external view returns (uint256, uint256);
    function stablecoin(address) external view returns (uint256);
    function movePosition(bytes32, address, address, int256, int256) external;
    function adjustPosition(bytes32, address, address, address, int256, int256) external;
    function moveCollateral(bytes32, address, address, uint256) external;
    function hope(address) external;
    function nope(address) external;
}

interface FarmableTokenAdapterLike {
    function collateralToken() external view returns (address);
    function collateralPoolId() external view returns (bytes32);
    function deposit(address, address, uint256) external;
    function withdraw(address, address, uint256) external;
    function moveRewards(address, address, uint256) external;
    function emergencyWithdraw(address, address) external;
}

interface TokenLike {
    function approve(address, uint256) external;
    function transferFrom(address, address, uint256) external;
}

contract PositionProxy {
    address immutable public usr;

    constructor(address government_, address usr_) public {
        usr = usr_;
        GovernmentLike(government_).hope(msg.sender);
    }
}

contract FarmableTokenManager {
    mapping (address => address) public proxy; // PositionProxy per user
    mapping (address => mapping (address => uint256)) public can;

    event Allow(address indexed from, address indexed to);
    event Disallow(address indexed from, address indexed to);

    address public immutable government;
    constructor(address government_) public {
        whitelist[msg.sender] = 1;
        emit Rely(msg.sender);
        government = government_;
    }

    mapping (address => uint256) public whitelist;

    event Rely(address indexed usr);
    event Deny(address indexed usr);

    modifier auth {
        require(whitelist[msg.sender] == 1, "CropManager/not-authed");
        _;
    }

    function rely(address usr) external auth {
        whitelist[usr] = 1;
        emit Rely(msg.sender);
    }

    function deny(address usr) external auth {
        whitelist[usr] = 0;
        emit Deny(msg.sender);
    }

    modifier allowed(address usr) {
        require(msg.sender == usr || can[usr][msg.sender] == 1, "CropManager/not-allowed");
        _;
    }

    function allow(address usr) external {
        can[msg.sender][usr] = 1;
        emit Allow(msg.sender, usr);
    }

    function disallow(address usr) external {
        can[msg.sender][usr] = 0;
        emit Disallow(msg.sender, usr);
    }

    function getOrCreateProxy(address usr) public returns (address urp) {
        urp = proxy[usr];
        if (urp == address(0)) {
            urp = proxy[usr] = address(new PositionProxy(address(government), usr));
        }
    }

    function deposit(address crop, address usr, uint256 val) external {
        TokenLike(FarmableTokenAdapterLike(crop).collateralToken()).transferFrom(msg.sender, address(this), val);
        TokenLike(FarmableTokenAdapterLike(crop).collateralToken()).approve(crop, val);
        FarmableTokenAdapterLike(crop).deposit(getOrCreateProxy(usr), usr, val);
    }

    function withdraw(address crop, address usr, uint256 val) external {
        address urp = proxy[msg.sender];
        require(urp != address(0), "CropManager/non-existing-urp");
        FarmableTokenAdapterLike(crop).withdraw(urp, usr, val);
    }

    function emergencyWithdraw(address crop) external {
        address urp = proxy[msg.sender];
        require(urp != address(0), "CropManager/non-existing-urp");
        FarmableTokenAdapterLike(crop).emergencyWithdraw(urp, msg.sender);
    }

    function adjustPosition(address crop, address u, address v, address w, int256 dink, int256 dart) external allowed(u) {
        require(u == v && w == msg.sender, "CropManager/not-matching");
        address urp = getOrCreateProxy(u);

        GovernmentLike(government).adjustPosition(FarmableTokenAdapterLike(crop).collateralPoolId(), urp, urp, w, dink, dart);
    }

    function moveCollateral(address crop, address src, address dst, uint256 wad) external allowed(src) {
        address surp = getOrCreateProxy(src);
        address durp = getOrCreateProxy(dst);

        GovernmentLike(government).moveCollateral(FarmableTokenAdapterLike(crop).collateralPoolId(), surp, durp, wad);
        FarmableTokenAdapterLike(crop).moveRewards(surp, durp, wad);
    }

    function onLiquidation(address crop, address usr, uint256 wad) external {
        // NOTE - this is not permissioned so be careful with what is done here
        // Send any outstanding rewhitelist to usr and moveRewards to the clipper
        address urp = proxy[usr];
        require(urp != address(0), "CropManager/non-existing-urp");
        FarmableTokenAdapterLike(crop).deposit(urp, usr, 0);
        FarmableTokenAdapterLike(crop).moveRewards(urp, msg.sender, wad);
    }

    function onGovernmentMoveCollateral(address crop, address from, address to, uint256 wad) external {
        // NOTE - this is not permissioned so be careful with what is done here
        FarmableTokenAdapterLike(crop).moveRewards(from, to, wad);
    }

    function quit(bytes32 collateralPoolId, address dst) external {
        require(GovernmentLike(government).live() == 0, "CropManager/government-still-live");

        address urp = getOrCreateProxy(msg.sender);
        (uint256 ink, uint256 art) = GovernmentLike(government).positions(collateralPoolId, urp);
        require(int256(ink) >= 0, "CropManager/overflow");
        require(int256(art) >= 0, "CropManager/overflow");
        GovernmentLike(government).movePosition(
            collateralPoolId,
            urp,
            dst,
            int256(ink),
            int256(art)
        );
    }
}