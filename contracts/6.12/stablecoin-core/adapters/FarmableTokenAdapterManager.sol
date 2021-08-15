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

interface VatLike {
    function live() external view returns (uint256);
    function urns(bytes32, address) external view returns (uint256, uint256);
    function dai(address) external view returns (uint256);
    function fork(bytes32, address, address, int256, int256) external;
    function frob(bytes32, address, address, address, int256, int256) external;
    function flux(bytes32, address, address, uint256) external;
    function hope(address) external;
    function nope(address) external;
}

interface CropLike {
    function gem() external view returns (address);
    function ilk() external view returns (bytes32);
    function join(address, address, uint256) external;
    function exit(address, address, uint256) external;
    function tack(address, address, uint256) external;
    function flee(address, address) external;
}

interface TokenLike {
    function approve(address, uint256) external;
    function transferFrom(address, address, uint256) external;
}

contract UrnProxy {
    address immutable public usr;

    constructor(address vat_, address usr_) public {
        usr = usr_;
        VatLike(vat_).hope(msg.sender);
    }
}

contract CropManager {
    address public implementation;
    mapping (address => uint256) public wards;

    event Rely(address indexed usr);
    event Deny(address indexed usr);
    event SetImplementation(address indexed);

    modifier auth {
        require(wards[msg.sender] == 1, "CropManager/not-authed");
        _;
    }

    constructor() public {
        wards[msg.sender] = 1;
        emit Rely(msg.sender);
    }

    function rely(address usr) external auth {
        wards[usr] = 1;
        emit Rely(msg.sender);
    }

    function deny(address usr) external auth {
        wards[usr] = 0;
        emit Deny(msg.sender);
    }

    function setImplementation(address implementation_) external auth {
        implementation = implementation_;
        emit SetImplementation(implementation_);
    }

    fallback() external {
        address _impl = implementation;
        require(_impl != address(0));

        assembly {
            let ptr := mload(0x40)
            calldatacopy(ptr, 0, calldatasize())
            let result := delegatecall(gas(), _impl, ptr, calldatasize(), 0, 0)
            let size := returndatasize()
            returndatacopy(ptr, 0, size)

            switch result
            case 0 { revert(ptr, size) }
            default { return(ptr, size) }
        }
    }
}

contract CropManagerImp {
    bytes32 slot0;
    bytes32 slot1;
    mapping (address => address) public proxy; // UrnProxy per user
    mapping (address => mapping (address => uint256)) public can;

    event Allow(address indexed from, address indexed to);
    event Disallow(address indexed from, address indexed to);

    address public immutable vat;
    constructor(address vat_) public {
        vat = vat_;
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
            urp = proxy[usr] = address(new UrnProxy(address(vat), usr));
        }
    }

    function join(address crop, address usr, uint256 val) external {
        TokenLike(CropLike(crop).gem()).transferFrom(msg.sender, address(this), val);
        TokenLike(CropLike(crop).gem()).approve(crop, val);
        CropLike(crop).join(getOrCreateProxy(usr), usr, val);
    }

    function exit(address crop, address usr, uint256 val) external {
        address urp = proxy[msg.sender];
        require(urp != address(0), "CropManager/non-existing-urp");
        CropLike(crop).exit(urp, usr, val);
    }

    function flee(address crop) external {
        address urp = proxy[msg.sender];
        require(urp != address(0), "CropManager/non-existing-urp");
        CropLike(crop).flee(urp, msg.sender);
    }

    function frob(address crop, address u, address v, address w, int256 dink, int256 dart) external allowed(u) {
        require(u == v && w == msg.sender, "CropManager/not-matching");
        address urp = getOrCreateProxy(u);

        VatLike(vat).frob(CropLike(crop).ilk(), urp, urp, w, dink, dart);
    }

    function flux(address crop, address src, address dst, uint256 wad) external allowed(src) {
        address surp = getOrCreateProxy(src);
        address durp = getOrCreateProxy(dst);

        VatLike(vat).flux(CropLike(crop).ilk(), surp, durp, wad);
        CropLike(crop).tack(surp, durp, wad);
    }

    function onLiquidation(address crop, address usr, uint256 wad) external {
        // NOTE - this is not permissioned so be careful with what is done here
        // Send any outstanding rewards to usr and tack to the clipper
        address urp = proxy[usr];
        require(urp != address(0), "CropManager/non-existing-urp");
        CropLike(crop).join(urp, usr, 0);
        CropLike(crop).tack(urp, msg.sender, wad);
    }

    function onVatFlux(address crop, address from, address to, uint256 wad) external {
        // NOTE - this is not permissioned so be careful with what is done here
        CropLike(crop).tack(from, to, wad);
    }

    function quit(bytes32 ilk, address dst) external {
        require(VatLike(vat).live() == 0, "CropManager/vat-still-live");

        address urp = getOrCreateProxy(msg.sender);
        (uint256 ink, uint256 art) = VatLike(vat).urns(ilk, urp);
        require(int256(ink) >= 0, "CropManager/overflow");
        require(int256(art) >= 0, "CropManager/overflow");
        VatLike(vat).fork(
            ilk,
            urp,
            dst,
            int256(ink),
            int256(art)
        );
    }
}