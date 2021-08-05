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
    function positions(bytes32, address) external view returns (uint256, uint256);
    function stablecoin(address) external view returns (uint256);
    function collateralToken(bytes32, address) external view returns (uint256);
    function addCollateral(bytes32, address, int256) external;
}

interface ERC20 {
    function balanceOf(address owner) external view returns (uint256);
    function transfer(address dst, uint256 amount) external returns (bool);
    function transferFrom(address src, address dst, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function decimals() external returns (uint8);
}

// receives tokens and shares them among holders
contract FarmableCollateralAdapter {
    mapping (address => uint256) whitelist;
    uint256 live;

    GovernmentLike     public immutable government;    // cdp engine
    bytes32     public immutable collateralPoolId;    // collateral type
    ERC20       public immutable collateralToken;    // collateral token
    uint256     public immutable decimals;    // collateralToken decimals
    ERC20       public immutable rewardToken;  // rewhitelist token

    uint256     public accRewardPerShare;  // rewards per collateralToken    [ray]
    uint256     public totalShare;  // total collateralTokens       [wad]
    uint256     public accRewardBalance;  // crop balance     [wad]

    mapping (address => uint256) public rewards; // rewards per user  [wad]
    mapping (address => uint256) public stake; // collateralTokens per user   [wad]

    uint256 immutable internal to18ConversionFactor;
    uint256 immutable internal toCollateralTokenConversionFactor;

    // --- Events ---
    event Deposit(uint256 val);
    event Withdraw(uint256 val);
    event Flee();
    event MoveRewards(address indexed src, address indexed dst, uint256 wad);

    modifier auth {
        require(whitelist[msg.sender] == 1, "FarmableCollateral/not-authed");
        _;
    }

    constructor(address government_, bytes32 collateralPoolId_, address collateralToken_, address rewardToken_) public {
        government = GovernmentLike(government_);
        collateralPoolId = collateralPoolId_;
        collateralToken = ERC20(collateralToken_);
        uint256 decimals_ = ERC20(collateralToken_).decimals();
        require(decimals_ <= 18);
        decimals = decimals_;
        to18ConversionFactor = 10 ** (18 - decimals_);
        toCollateralTokenConversionFactor = 10 ** decimals_;
        rewardToken = ERC20(rewardToken_);
    }

    function add(uint256 x, uint256 y) public pure returns (uint256 z) {
        require((z = x + y) >= x, "ds-math-add-overflow");
    }
    function sub(uint256 x, uint256 y) public pure returns (uint256 z) {
        require((z = x - y) <= x, "ds-math-sub-underflow");
    }
    function mul(uint256 x, uint256 y) public pure returns (uint256 z) {
        require(y == 0 || (z = x * y) / y == x, "ds-math-mul-overflow");
    }
    function divup(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = add(x, sub(y, 1)) / y;
    }
    uint256 constant WAD  = 10 ** 18;
    function wmul(uint256 x, uint256 y) public pure returns (uint256 z) {
        z = mul(x, y) / WAD;
    }
    function wdiv(uint256 x, uint256 y) public pure returns (uint256 z) {
        z = mul(x, WAD) / y;
    }
    function wdivup(uint256 x, uint256 y) public pure returns (uint256 z) {
        z = divup(mul(x, WAD), y);
    }
    uint256 constant RAY  = 10 ** 27;
    function rmul(uint256 x, uint256 y) public pure returns (uint256 z) {
        z = mul(x, y) / RAY;
    }
    function rmulup(uint256 x, uint256 y) public pure returns (uint256 z) {
        z = divup(mul(x, y), RAY);
    }
    function rdiv(uint256 x, uint256 y) public pure returns (uint256 z) {
        z = mul(x, RAY) / y;
    }

    // Net Asset Valuation [wad]
    function nav() public virtual view returns (uint256) {
        uint256 _nav = collateralToken.balanceOf(address(this));
        return mul(_nav, to18ConversionFactor);
    }

    // Net Assets per Share [wad]
    function nps() public view returns (uint256) {
        if (totalShare == 0) return WAD;
        else return wdiv(nav(), totalShare);
    }

    function harvestedRewards() internal virtual returns (uint256) {
        return sub(rewardToken.balanceOf(address(this)), accRewardBalance);
    }

    function harvest(address from, address to) internal {
        if (totalShare > 0) accRewardPerShare = add(accRewardPerShare, rdiv(harvestedRewards(), totalShare));

        uint256 last = rewards[from];
        uint256 curr = rmul(stake[from], accRewardPerShare);
        if (curr > last) require(rewardToken.transfer(to, curr - last));
        accRewardBalance = rewardToken.balanceOf(address(this));
    }

    function deposit(address positionAddress, address usr, uint256 val) public auth virtual {
        require(live == 1, "FarmableCollateral/not-live");

        harvest(positionAddress, usr);
        if (val > 0) {
            uint256 wad = wdiv(mul(val, to18ConversionFactor), nps());

            // Overflow check for int256(wad) cast below
            // Also enforces a non-zero wad
            require(int256(wad) > 0);

            require(collateralToken.transferFrom(msg.sender, address(this), val));
            government.addCollateral(collateralPoolId, positionAddress, int256(wad));

            totalShare = add(totalShare, wad);
            stake[positionAddress] = add(stake[positionAddress], wad);
        }
        rewards[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);
        emit Deposit(val);
    }

    function withdraw(address positionAddress, address usr, uint256 val) public auth virtual {
        harvest(positionAddress, usr);
        if (val > 0) {
            uint256 wad = wdivup(mul(val, to18ConversionFactor), nps());

            // Overflow check for int256(wad) cast below
            // Also enforces a non-zero wad
            require(int256(wad) > 0);

            require(collateralToken.transfer(usr, val));
            government.addCollateral(collateralPoolId, positionAddress, -int256(wad));

            totalShare = sub(totalShare, wad);
            stake[positionAddress] = sub(stake[positionAddress], wad);
        }
        rewards[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);
        emit Withdraw(val);
    }

    function emergencyWithdraw(address positionAddress, address usr) public auth virtual {
        uint256 wad = government.collateralToken(collateralPoolId, positionAddress);
        require(wad <= 2 ** 255);
        uint256 val = wmul(wmul(wad, nps()), toCollateralTokenConversionFactor);

        require(collateralToken.transfer(usr, val));
        government.addCollateral(collateralPoolId, positionAddress, -int256(wad));

        totalShare = sub(totalShare, wad);
        stake[positionAddress] = sub(stake[positionAddress], wad);
        rewards[positionAddress] = rmulup(stake[positionAddress], accRewardPerShare);

        emit Flee();
    }

    function moveRewards(address src, address dst, uint256 wad) public {
        uint256 ss = stake[src];
        stake[src] = sub(ss, wad);
        stake[dst] = add(stake[dst], wad);

        uint256 cs     = rewards[src];
        uint256 drewards = mul(cs, wad) / ss;

        // safe since drewards <= rewards[src]
        rewards[src] = cs - drewards;
        rewards[dst] = add(rewards[dst], drewards);

        (uint256 lockedCollateral,) = government.positions(collateralPoolId, src);
        require(stake[src] >= add(government.collateralToken(collateralPoolId, src), lockedCollateral));
        (lockedCollateral,) = government.positions(collateralPoolId, dst);
        require(stake[dst] <= add(government.collateralToken(collateralPoolId, dst), lockedCollateral));

        emit MoveRewards(src, dst, wad);
    }

    function cage() public auth virtual {
        live = 0;
    }
}