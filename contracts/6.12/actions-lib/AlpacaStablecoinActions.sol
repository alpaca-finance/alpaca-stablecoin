// SPDX-License-Identifier: AGPL-3.0-or-later

// Copyright (C) 2018-2020 Maker Ecosystem Growth Holdings, INC.

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

pragma solidity >=0.5.12;

interface TokenLike {
    function approve(address, uint) external;
    function transfer(address, uint) external;
    function transferFrom(address, address, uint) external;
    function deposit() external payable;
    function withdraw(uint) external;
}

interface ManagerLike {
    function cdpCan(address, uint, address) external view returns (uint);
    function collateralPools(uint) external view returns (bytes32);
    function owns(uint) external view returns (address);
    function positions(uint) external view returns (address);
    function government() external view returns (address);
    function open(bytes32, address) external returns (uint);
    function give(uint, address) external;
    function cdpAllow(uint, address, uint) external;
    function positionAllow(address, uint) external;
    function adjustPosition(uint, int, int) external;
    function moveCollateral(uint, address, uint) external;
    function moveStablecoin(uint, address, uint) external;
    function withdraw(address, uint, address, uint) external;
    function quit(uint, address) external;
    function enter(address, uint) external;
    function shift(uint, uint) external;
}

interface GovernmentLike {
    function can(address, address) external view returns (uint);
    function collateralPools(bytes32) external view returns (uint, uint, uint, uint, uint);
    function stablecoin(address) external view returns (uint);
    function positions(bytes32, address) external view returns (uint, uint);
    function adjustPosition(bytes32, address, address, address, int, int) external;
    function hope(address) external;
    function moveStablecoin(address, address, uint) external;
}

interface TokenAdapterLike {
    function decimals() external returns (uint);
    function collateralToken() external returns (TokenLike);
    function deposit(address, uint) external payable;
    function withdraw(address, uint) external;
}

interface FarmableTokenAdapterLike {
    function decimals() external returns (uint);
    function collateralToken() external returns (TokenLike);
    function deposit(address, address, uint) external payable;
    function withdraw(address, address, uint) external;
}

interface StablecoinAdapterLike {
    function government() external returns (GovernmentLike);
    function stablecoin() external returns (TokenLike);
    function deposit(address, uint) external payable;
    function withdraw(address, uint) external;
}

interface HopeLike {
    function hope(address) external;
    function nope(address) external;
}

interface StabilityFeeCollectorLike {
    function collect(bytes32) external returns (uint);
}

interface ProxyRegistryLike {
    function proxies(address) external view returns (address);
    function build(address) external returns (address);
}

interface ProxyLike {
    function owner() external view returns (address);
}

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// WARNING: These functions meant to be used as a a library for a DSProxy. Some are unsafe if you call them directly.
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

contract Common {
    uint256 constant RAY = 10 ** 27;

    // Internal functions

    function mul(uint x, uint y) internal pure returns (uint z) {
        require(y == 0 || (z = x * y) / y == x, "mul-overflow");
    }

    // Public functions

    function stablecoinAdapter_deposit(address apt, address positionAddress, uint wad) public {
        // Gets Alpaca Stablecoin from the user's wallet
        StablecoinAdapterLike(apt).stablecoin().transferFrom(msg.sender, address(this), wad);
        // Approves adapter to take the Alpaca Stablecoin amount
        StablecoinAdapterLike(apt).stablecoin().approve(apt, wad);
        // Deposits Alpaca Stablecoin into the government
        StablecoinAdapterLike(apt).deposit(positionAddress, wad);
    }
}

contract AlpacaStablecoinActions is Common {
    // Internal functions

    function sub(uint x, uint y) internal pure returns (uint z) {
        require((z = x - y) <= x, "sub-overflow");
    }

    function toInt(uint x) internal pure returns (int y) {
        y = int(x);
        require(y >= 0, "int-overflow");
    }

    function toRad(uint wad) internal pure returns (uint rad) {
        rad = mul(wad, 10 ** 27);
    }

    function convertTo18(address collateralTokenAdapter, uint256 amt) internal returns (uint256 wad) {
        // For those collaterals that have less than 18 decimals precision we need to do the conversion before passing to adjustPosition function
        // Adapters will automatically handle the difference of precision
        wad = mul(
            amt,
            10 ** (18 - TokenAdapterLike(collateralTokenAdapter).decimals())
        );
    }

    function _getDrawDebtShare(
        address government,
        address stabilityFeeCollector,
        address positionAddress,
        bytes32 collateralPoolId,
        uint wad
    ) internal returns (int resultDebtShare) {
        // Updates stability fee rate
        uint debtAccumulatedRate = StabilityFeeCollectorLike(stabilityFeeCollector).collect(collateralPoolId);

        // Gets Alpaca Stablecoin balance of the positionAddress in the government
        uint stablecoin = GovernmentLike(government).stablecoin(positionAddress);

        // If there was already enough Alpaca Stablecoin in the government balance, just exits it without adding more debt
        if (stablecoin < mul(wad, RAY)) {
            // Calculates the needed resultDebtShare so together with the existing stablecoin in the government is enough to exit wad amount of Alpaca Stablecoin tokens
            resultDebtShare = toInt(sub(mul(wad, RAY), stablecoin) / debtAccumulatedRate);
            // This is neeeded due lack of precision. It might need to sum an extra resultDebtShare wei (for the given Alpaca Stablecoin wad amount)
            resultDebtShare = mul(uint(resultDebtShare), debtAccumulatedRate) < mul(wad, RAY) ? resultDebtShare + 1 : resultDebtShare;
        }
    }

    function _getWipeDebtShare(
        address government,
        uint stablecoinBalance,
        address positionAddress,
        bytes32 collateralPoolId
    ) internal view returns (int resultDebtShare) {
        // Gets actual rate from the government
        (, uint debtAccumulatedRate,,,) = GovernmentLike(government).collateralPools(collateralPoolId);
        // Gets actual debtShare value of the positionAddress
        (, uint debtShare) = GovernmentLike(government).positions(collateralPoolId, positionAddress);

        // Uses the whole stablecoin balance in the government to reduce the debt
        resultDebtShare = toInt(stablecoinBalance / debtAccumulatedRate);
        // Checks the calculated resultDebtShare is not higher than positionAddress.art (total debt), otherwise uses its value
        resultDebtShare = uint(resultDebtShare) <= debtShare ? - resultDebtShare : - toInt(debtShare);
    }

    function _getWipeAllWad(
        address government,
        address usr,
        address positionAddress,
        bytes32 collateralPoolId
    ) internal view returns (uint wad) {
        // Gets actual rate from the government
        (, uint rate,,,) = GovernmentLike(government).collateralPools(collateralPoolId);
        // Gets actual debtShare value of the positionAddress
        (, uint debtShare) = GovernmentLike(government).positions(collateralPoolId, positionAddress);
        // Gets actual stablecoin amount in the positionAddress
        uint stablecoin = GovernmentLike(government).stablecoin(usr);

        uint rad = sub(mul(debtShare, rate), stablecoin);
        wad = rad / RAY;

        // If the rad precision has some dust, it will need to request for 1 extra wad wei
        wad = mul(wad, RAY) < rad ? wad + 1 : wad;
    }

    // Public functions

    function transfer(address collateralToken, address dst, uint amt) public {
        TokenLike(collateralToken).transfer(dst, amt);
    }

    function bnbAdapter_deposit(address apt, address positionAddress) public payable {
        // Wraps BNB in WBNB
        TokenAdapterLike(apt).collateralToken().deposit.value(msg.value)();
        // Approves adapter to take the WBNB amount
        TokenAdapterLike(apt).collateralToken().approve(address(apt), msg.value);
        // Deposits WBNB collateral into the government
        TokenAdapterLike(apt).deposit(positionAddress, msg.value);
    }

    function collateralTokenAdapter_deposit(address apt, address positionAddress, uint amt, bool transferFrom) public {
        // Only executes for tokens that have approval/transferFrom implementation
        if (transferFrom) {
            // Gets token from the user's wallet
            TokenAdapterLike(apt).collateralToken().transferFrom(msg.sender, address(this), amt);
            // Approves adapter to take the token amount
            TokenAdapterLike(apt).collateralToken().approve(apt, amt);
        }
        // Deposits token collateral into the government
        TokenAdapterLike(apt).deposit(positionAddress, amt);
    }

    function farmableCollateralAdapter_deposit(address apt, address positionAddress, uint amt, bool transferFrom) public {
        // Only executes for tokens that have approval/transferFrom implementation
        if (transferFrom) {
            // Gets token from the user's wallet
            FarmableTokenAdapterLike(apt).collateralToken().transferFrom(msg.sender, address(this), amt);
            // Approves adapter to take the token amount
            FarmableTokenAdapterLike(apt).collateralToken().approve(apt, amt);
        }
        // Deposits token collateral into the government
        FarmableTokenAdapterLike(apt).deposit(positionAddress, msg.sender, amt);
    }

    function hope(
        address obj,
        address usr
    ) public {
        HopeLike(obj).hope(usr);
    }

    function nope(
        address obj,
        address usr
    ) public {
        HopeLike(obj).nope(usr);
    }

    function open(
        address manager,
        bytes32 collateralPoolId,
        address usr
    ) public returns (uint cdp) {
        cdp = ManagerLike(manager).open(collateralPoolId, usr);
    }

    function give(
        address manager,
        uint cdp,
        address usr
    ) public {
        ManagerLike(manager).give(cdp, usr);
    }

    function giveToProxy(
        address proxyRegistry,
        address manager,
        uint cdp,
        address dst
    ) public {
        // Gets actual proxy address
        address proxy = ProxyRegistryLike(proxyRegistry).proxies(dst);
        // Checks if the proxy address already existed and dst address is still the owner
        if (proxy == address(0) || ProxyLike(proxy).owner() != dst) {
            uint csize;
            assembly {
                csize := extcodesize(dst)
            }
            // We want to avoid creating a proxy for a contract address that might not be able to handle proxies, then losing the CDP
            require(csize == 0, "Dst-is-a-contract");
            // Creates the proxy for the dst address
            proxy = ProxyRegistryLike(proxyRegistry).build(dst);
        }
        // Transfers CDP to the dst proxy
        give(manager, cdp, proxy);
    }

    function cdpAllow(
        address manager,
        uint cdp,
        address usr,
        uint ok
    ) public {
        ManagerLike(manager).cdpAllow(cdp, usr, ok);
    }

    function positionAllow(
        address manager,
        address usr,
        uint ok
    ) public {
        ManagerLike(manager).positionAllow(usr, ok);
    }

    function moveCollateral(
        address manager,
        uint cdp,
        address dst,
        uint wad
    ) public {
        ManagerLike(manager).moveCollateral(cdp, dst, wad);
    }

    function moveStablecoin(
        address manager,
        uint cdp,
        address dst,
        uint rad
    ) public {
        ManagerLike(manager).moveStablecoin(cdp, dst, rad);
    }

    function adjustPosition(
        address manager,
        uint cdp,
        int dink,
        int dart
    ) public {
        ManagerLike(manager).adjustPosition(cdp, dink, dart);
    }

    function quit(
        address manager,
        uint cdp,
        address dst
    ) public {
        ManagerLike(manager).quit(cdp, dst);
    }

    function enter(
        address manager,
        address src,
        uint cdp
    ) public {
        ManagerLike(manager).enter(src, cdp);
    }

    function shift(
        address manager,
        uint cdpSrc,
        uint cdpOrg
    ) public {
        ManagerLike(manager).shift(cdpSrc, cdpOrg);
    }

    function lockBNB(
        address manager,
        address bnbAdapter,
        uint cdp
    ) public payable {
        // Receives BNB amount, converts it to WBNB and joins it into the government
        bnbAdapter_deposit(bnbAdapter, address(this));
        // Locks WBNB amount into the CDP
        GovernmentLike(ManagerLike(manager).government()).adjustPosition(
            ManagerLike(manager).collateralPools(cdp),
            ManagerLike(manager).positions(cdp),
            address(this),
            address(this),
            toInt(msg.value),
            0
        );
    }

    function safeLockBNB(
        address manager,
        address bnbAdapter,
        uint cdp,
        address owner
    ) public payable {
        require(ManagerLike(manager).owns(cdp) == owner, "owner-missmatch");
        lockBNB(manager, bnbAdapter, cdp);
    }

    function lockToken(
        address manager,
        address collateralTokenAdapter,
        uint cdp,
        uint amt,
        bool transferFrom
    ) public {
        // Takes token amount from user's wallet and joins into the government
        collateralTokenAdapter_deposit(collateralTokenAdapter, address(this), amt, transferFrom);
        // Locks token amount into the CDP
        GovernmentLike(ManagerLike(manager).government()).adjustPosition(
            ManagerLike(manager).collateralPools(cdp),
            ManagerLike(manager).positions(cdp),
            address(this),
            address(this),
            toInt(convertTo18(collateralTokenAdapter, amt)),
            0
        );
    }

    function lockFarmableToken(
        address manager,
        address farmableCollateralAdapter,
        uint cdp,
        uint amt,
        bool transferFrom
    ) public {
        // Takes token amount from user's wallet and joins into the government
        farmableCollateralAdapter_deposit(farmableCollateralAdapter, address(this), amt, transferFrom);
        // Locks token amount into the CDP
        GovernmentLike(ManagerLike(manager).government()).adjustPosition(
            ManagerLike(manager).collateralPools(cdp),
            ManagerLike(manager).positions(cdp),
            address(this),
            address(this),
            toInt(convertTo18(farmableCollateralAdapter, amt)),
            0
        );
    }

    function safeLockToken(
        address manager,
        address collateralTokenAdapter,
        uint cdp,
        uint amt,
        bool transferFrom,
        address owner
    ) public {
        require(ManagerLike(manager).owns(cdp) == owner, "owner-missmatch");
        lockToken(manager, collateralTokenAdapter, cdp, amt, transferFrom);
    }

    function safeLockFarmableToken(
        address manager,
        address farmableCollateralAdapter,
        uint cdp,
        uint amt,
        bool transferFrom,
        address owner
    ) public {
        require(ManagerLike(manager).owns(cdp) == owner, "owner-missmatch");
        lockFarmableToken(manager, farmableCollateralAdapter, cdp, amt, transferFrom);
    }

    function freeBNB(
        address manager,
        address bnbAdapter,
        uint cdp,
        uint wad
    ) public {
        // Unlocks WBNB amount from the CDP
        adjustPosition(manager, cdp, -toInt(wad), 0);
        // Moves the amount from the CDP positionAddress to proxy's address
        moveCollateral(manager, cdp, address(this), wad);
        // Withdraws WBNB amount to proxy address as a token
        TokenAdapterLike(bnbAdapter).withdraw(address(this), wad);
        // Converts WBNB to BNB
        TokenAdapterLike(bnbAdapter).collateralToken().withdraw(wad);
        // Sends BNB back to the user's wallet
        msg.sender.transfer(wad);
    }

    function freeToken(
        address manager,
        address collateralTokenAdapter,
        uint cdp,
        uint amt
    ) public {
        uint wad = convertTo18(collateralTokenAdapter, amt);
        // Unlocks token amount from the CDP
        adjustPosition(manager, cdp, -toInt(wad), 0);
        // Moves the amount from the CDP positionAddress to proxy's address
        moveCollateral(manager, cdp, address(this), wad);
        // Withdraws token amount to the user's wallet as a token
        TokenAdapterLike(collateralTokenAdapter).withdraw(msg.sender, amt);
    }

    function freeFarmableToken(
        address manager,
        address farmableCollateralAdapter,
        uint cdp,
        uint amt
    ) public {
        address positionAddress = ManagerLike(manager).positions(cdp);
        uint wad = convertTo18(farmableCollateralAdapter, amt);
        // Unlocks token amount from the CDP
        adjustPosition(manager, cdp, -toInt(wad), 0);
        // Moves the amount from the CDP positionAddress to proxy's address
        moveCollateral(manager, cdp, address(this), wad);
        // Withdraws token amount to the user's wallet as a token
        FarmableTokenAdapterLike(farmableCollateralAdapter).withdraw(positionAddress, msg.sender, amt);
    }

    function exitBNB(
        address manager,
        address bnbAdapter,
        uint cdp,
        uint wad
    ) public {
        // Moves the amount from the CDP positionAddress to proxy's address
        moveCollateral(manager, cdp, address(this), wad);

        // Withdraws WBNB amount to proxy address as a token
        TokenAdapterLike(bnbAdapter).withdraw(address(this), wad);
        // Converts WBNB to BNB
        TokenAdapterLike(bnbAdapter).collateralToken().withdraw(wad);
        // Sends BNB back to the user's wallet
        msg.sender.transfer(wad);
    }

    function exitToken(
        address manager,
        address collateralTokenAdapter,
        uint cdp,
        uint amt
    ) public {
        // Moves the amount from the CDP positionAddress to proxy's address
        moveCollateral(manager, cdp, address(this), convertTo18(collateralTokenAdapter, amt));

        // Withdraws token amount to the user's wallet as a token
        TokenAdapterLike(collateralTokenAdapter).withdraw(msg.sender, amt);
    }

    function exitFarmableToken(
        address manager,
        address farmableCollateralAdapter,
        uint cdp,
        uint amt
    ) public {
        address positionAddress = ManagerLike(manager).positions(cdp);
        // Moves the amount from the CDP positionAddress to proxy's address
        moveCollateral(manager, cdp, address(this), convertTo18(farmableCollateralAdapter, amt));

        // Withdraws token amount to the user's wallet as a token
        FarmableTokenAdapterLike(farmableCollateralAdapter).withdraw(positionAddress, msg.sender, amt);
    }

    function draw(
        address manager,
        address stabilityFeeCollector,
        address stablecoinAdapter,
        uint cdp,
        uint wad
    ) public {
        address positionAddress = ManagerLike(manager).positions(cdp);
        address government = ManagerLike(manager).government();
        bytes32 collateralPoolId = ManagerLike(manager).collateralPools(cdp);
        // Generates debt in the CDP
        adjustPosition(manager, cdp, 0, _getDrawDebtShare(government, stabilityFeeCollector, positionAddress, collateralPoolId, wad));
        // Moves the Alpaca Stablecoin amount (balance in the government in rad) to proxy's address
        moveStablecoin(manager, cdp, address(this), toRad(wad));
        // Allows adapter to access to proxy's Alpaca Stablecoin balance in the government
        if (GovernmentLike(government).can(address(this), address(stablecoinAdapter)) == 0) {
            GovernmentLike(government).hope(stablecoinAdapter);
        }
        // Withdraws Alpaca Stablecoin to the user's wallet as a token
        StablecoinAdapterLike(stablecoinAdapter).withdraw(msg.sender, wad);
    }

    function wipe(
        address manager,
        address stablecoinAdapter,
        uint cdp,
        uint wad
    ) public {
        address government = ManagerLike(manager).government();
        address positionAddress = ManagerLike(manager).positions(cdp);
        bytes32 collateralPoolId = ManagerLike(manager).collateralPools(cdp);

        address own = ManagerLike(manager).owns(cdp);
        if (own == address(this) || ManagerLike(manager).cdpCan(own, cdp, address(this)) == 1) {
            // Deposits Alpaca Stablecoin amount into the government
            stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, wad);
            // Paybacks debt to the CDP
            adjustPosition(manager, cdp, 0, _getWipeDebtShare(government, GovernmentLike(government).stablecoin(positionAddress), positionAddress, collateralPoolId));
        } else {
             // Deposits Alpaca Stablecoin amount into the government
            stablecoinAdapter_deposit(stablecoinAdapter, address(this), wad);
            // Paybacks debt to the CDP
            GovernmentLike(government).adjustPosition(
                collateralPoolId,
                positionAddress,
                address(this),
                address(this),
                0,
                _getWipeDebtShare(government, wad * RAY, positionAddress, collateralPoolId)
            );
        }
    }

    function safeWipe(
        address manager,
        address stablecoinAdapter,
        uint cdp,
        uint wad,
        address owner
    ) public {
        require(ManagerLike(manager).owns(cdp) == owner, "owner-missmatch");
        wipe(manager, stablecoinAdapter, cdp, wad);
    }

    function wipeAll(
        address manager,
        address stablecoinAdapter,
        uint cdp
    ) public {
        address government = ManagerLike(manager).government();
        address positionAddress = ManagerLike(manager).positions(cdp);
        bytes32 collateralPoolId = ManagerLike(manager).collateralPools(cdp);
        (, uint debtShare) = GovernmentLike(government).positions(collateralPoolId, positionAddress);

        address own = ManagerLike(manager).owns(cdp);
        if (own == address(this) || ManagerLike(manager).cdpCan(own, cdp, address(this)) == 1) {
            // Deposits Alpaca Stablecoin amount into the government
            stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, _getWipeAllWad(government, positionAddress, positionAddress, collateralPoolId));
            // Paybacks debt to the CDP
            adjustPosition(manager, cdp, 0, -int(debtShare));
        } else {
            // Deposits Alpaca Stablecoin amount into the government
            stablecoinAdapter_deposit(stablecoinAdapter, address(this), _getWipeAllWad(government, address(this), positionAddress, collateralPoolId));
            // Paybacks debt to the CDP
            GovernmentLike(government).adjustPosition(
                collateralPoolId,
                positionAddress,
                address(this),
                address(this),
                0,
                -int(debtShare)
            );
        }
    }

    function safeWipeAll(
        address manager,
        address stablecoinAdapter,
        uint cdp,
        address owner
    ) public {
        require(ManagerLike(manager).owns(cdp) == owner, "owner-missmatch");
        wipeAll(manager, stablecoinAdapter, cdp);
    }

    function lockBNBAndDraw(
        address manager,
        address stabilityFeeCollector,
        address bnbAdapter,
        address stablecoinAdapter,
        uint cdp,
        uint wadD
    ) public payable {
        address positionAddress = ManagerLike(manager).positions(cdp);
        address government = ManagerLike(manager).government();
        bytes32 collateralPoolId = ManagerLike(manager).collateralPools(cdp);
        // Receives BNB amount, converts it to WBNB and joins it into the government
        bnbAdapter_deposit(bnbAdapter, positionAddress);
        // Locks WBNB amount into the CDP and generates debt
        adjustPosition(manager, cdp, toInt(msg.value), _getDrawDebtShare(government, stabilityFeeCollector, positionAddress, collateralPoolId, wadD));
        // Moves the Alpaca Stablecoin amount (balance in the government in rad) to proxy's address
        moveStablecoin(manager, cdp, address(this), toRad(wadD));
        // Allows adapter to access to proxy's Alpaca Stablecoin balance in the government
        if (GovernmentLike(government).can(address(this), address(stablecoinAdapter)) == 0) {
            GovernmentLike(government).hope(stablecoinAdapter);
        }
        // Withdraws Alpaca Stablecoin to the user's wallet as a token
        StablecoinAdapterLike(stablecoinAdapter).withdraw(msg.sender, wadD);
    }

    function openLockBNBAndDraw(
        address manager,
        address stabilityFeeCollector,
        address bnbAdapter,
        address stablecoinAdapter,
        bytes32 collateralPoolId,
        uint wadD
    ) public payable returns (uint cdp) {
        cdp = open(manager, collateralPoolId, address(this));
        lockBNBAndDraw(manager, stabilityFeeCollector, bnbAdapter, stablecoinAdapter, cdp, wadD);
    }

    function lockTokenAndDraw(
        address manager,
        address stabilityFeeCollector,
        address collateralTokenAdapter,
        address stablecoinAdapter,
        uint cdp,
        uint amtC,
        uint wadD,
        bool transferFrom
    ) public {
        address positionAddress = ManagerLike(manager).positions(cdp);
        address government = ManagerLike(manager).government();
        bytes32 collateralPoolId = ManagerLike(manager).collateralPools(cdp);
        // Takes token amount from user's wallet and joins into the government
        collateralTokenAdapter_deposit(collateralTokenAdapter, positionAddress, amtC, transferFrom);
        // Locks token amount into the CDP and generates debt
        adjustPosition(manager, cdp, toInt(convertTo18(collateralTokenAdapter, amtC)), _getDrawDebtShare(government, stabilityFeeCollector, positionAddress, collateralPoolId, wadD));
        // Moves the Alpaca Stablecoin amount (balance in the government in rad) to proxy's address
        moveStablecoin(manager, cdp, address(this), toRad(wadD));
        // Allows adapter to access to proxy's Alpaca Stablecoin balance in the government
        if (GovernmentLike(government).can(address(this), address(stablecoinAdapter)) == 0) {
            GovernmentLike(government).hope(stablecoinAdapter);
        }
        // Withdraws Alpaca Stablecoin to the user's wallet as a token
        StablecoinAdapterLike(stablecoinAdapter).withdraw(msg.sender, wadD);
    }

    function openLockTokenAndDraw(
        address manager,
        address stabilityFeeCollector,
        address collateralTokenAdapter,
        address stablecoinAdapter,
        bytes32 collateralPoolId,
        uint amtC,
        uint wadD,
        bool transferFrom
    ) public returns (uint cdp) {
        cdp = open(manager, collateralPoolId, address(this));
        lockTokenAndDraw(manager, stabilityFeeCollector, collateralTokenAdapter, stablecoinAdapter, cdp, amtC, wadD, transferFrom);
    }

    function lockFarmableTokenAndDraw(
        address manager,
        address stabilityFeeCollector,
        address farmableCollateralAdapter,
        address stablecoinAdapter,
        uint cdp,
        uint amtC,
        uint wadD,
        bool transferFrom
    ) public {
        address positionAddress = ManagerLike(manager).positions(cdp);
        address government = ManagerLike(manager).government();
        bytes32 collateralPoolId = ManagerLike(manager).collateralPools(cdp);
        // Takes token amount from user's wallet and joins into the government
        farmableCollateralAdapter_deposit(farmableCollateralAdapter, positionAddress, amtC, transferFrom);
        // Locks token amount into the CDP and generates debt
        adjustPosition(manager, cdp, toInt(convertTo18(farmableCollateralAdapter, amtC)), _getDrawDebtShare(government, stabilityFeeCollector, positionAddress, collateralPoolId, wadD));
        // Moves the Alpaca Stablecoin amount (balance in the government in rad) to proxy's address
        moveStablecoin(manager, cdp, address(this), toRad(wadD));
        // Allows adapter to access to proxy's Alpaca Stablecoin balance in the government
        if (GovernmentLike(government).can(address(this), address(stablecoinAdapter)) == 0) {
            GovernmentLike(government).hope(stablecoinAdapter);
        }
        // Withdraws Alpaca Stablecoin to the user's wallet as a token
        StablecoinAdapterLike(stablecoinAdapter).withdraw(msg.sender, wadD);
    }

    function openLockFarmableTokenAndDraw(
        address manager,
        address stabilityFeeCollector,
        address farmableCollateralAdapter,
        address stablecoinAdapter,
        bytes32 collateralPoolId,
        uint amtC,
        uint wadD,
        bool transferFrom
    ) public returns (uint cdp) {
        cdp = open(manager, collateralPoolId, address(this));
        lockFarmableTokenAndDraw(manager, stabilityFeeCollector, farmableCollateralAdapter, stablecoinAdapter, cdp, amtC, wadD, transferFrom);
    }

    function wipeAndFreeBNB(
        address manager,
        address bnbAdapter,
        address stablecoinAdapter,
        uint cdp,
        uint wadC,
        uint wadD
    ) public {
        address positionAddress = ManagerLike(manager).positions(cdp);
        // Deposits Alpaca Stablecoin amount into the government
        stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, wadD);
        // Paybacks debt to the CDP and unlocks WBNB amount from it
        adjustPosition(
            manager,
            cdp,
            -toInt(wadC),
            _getWipeDebtShare(ManagerLike(manager).government(), GovernmentLike(ManagerLike(manager).government()).stablecoin(positionAddress), positionAddress, ManagerLike(manager).collateralPools(cdp))
        );
        // Moves the amount from the CDP positionAddress to proxy's address
        moveCollateral(manager, cdp, address(this), wadC);
        // Withdraws WBNB amount to proxy address as a token
        TokenAdapterLike(bnbAdapter).withdraw(address(this), wadC);
        // Converts WBNB to BNB
        TokenAdapterLike(bnbAdapter).collateralToken().withdraw(wadC);
        // Sends BNB back to the user's wallet
        msg.sender.transfer(wadC);
    }

    function wipeAllAndFreeBNB(
        address manager,
        address bnbAdapter,
        address stablecoinAdapter,
        uint cdp,
        uint wadC
    ) public {
        address government = ManagerLike(manager).government();
        address positionAddress = ManagerLike(manager).positions(cdp);
        bytes32 collateralPoolId = ManagerLike(manager).collateralPools(cdp);
        (, uint debtShare) = GovernmentLike(government).positions(collateralPoolId, positionAddress);

        // Deposits Alpaca Stablecoin amount into the government
        stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, _getWipeAllWad(government, positionAddress, positionAddress, collateralPoolId));
        // Paybacks debt to the CDP and unlocks WBNB amount from it
        adjustPosition(
            manager,
            cdp,
            -toInt(wadC),
            -int(debtShare)
        );
        // Moves the amount from the CDP positionAddress to proxy's address
        moveCollateral(manager, cdp, address(this), wadC);
        // Withdraws WBNB amount to proxy address as a token
        TokenAdapterLike(bnbAdapter).withdraw(address(this), wadC);
        // Converts WBNB to BNB
        TokenAdapterLike(bnbAdapter).collateralToken().withdraw(wadC);
        // Sends BNB back to the user's wallet
        msg.sender.transfer(wadC);
    }

    function wipeAndFreeToken(
        address manager,
        address collateralTokenAdapter,
        address stablecoinAdapter,
        uint cdp,
        uint amtC,
        uint wadD
    ) public {
        address positionAddress = ManagerLike(manager).positions(cdp);
        // Deposits Alpaca Stablecoin amount into the government
        stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, wadD);
        uint wadC = convertTo18(collateralTokenAdapter, amtC);
        // Paybacks debt to the CDP and unlocks token amount from it
        adjustPosition(
            manager,
            cdp,
            -toInt(wadC),
            _getWipeDebtShare(ManagerLike(manager).government(), GovernmentLike(ManagerLike(manager).government()).stablecoin(positionAddress), positionAddress, ManagerLike(manager).collateralPools(cdp))
        );
        // Moves the amount from the CDP positionAddress to proxy's address
        moveCollateral(manager, cdp, address(this), wadC);
        // Withdraws token amount to the user's wallet as a token
        TokenAdapterLike(collateralTokenAdapter).withdraw(msg.sender, amtC);
    }

    function wipeAllAndFreeToken(
        address manager,
        address collateralTokenAdapter,
        address stablecoinAdapter,
        uint cdp,
        uint amtC
    ) public {
        address government = ManagerLike(manager).government();
        address positionAddress = ManagerLike(manager).positions(cdp);
        bytes32 collateralPoolId = ManagerLike(manager).collateralPools(cdp);
        (, uint debtShare) = GovernmentLike(government).positions(collateralPoolId, positionAddress);

        // Deposits Alpaca Stablecoin amount into the government
        stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, _getWipeAllWad(government, positionAddress, positionAddress, collateralPoolId));
        uint wadC = convertTo18(collateralTokenAdapter, amtC);
        // Paybacks debt to the CDP and unlocks token amount from it
        adjustPosition(
            manager,
            cdp,
            -toInt(wadC),
            -int(debtShare)
        );
        // Moves the amount from the CDP positionAddress to proxy's address
        moveCollateral(manager, cdp, address(this), wadC);
        // Withdraws token amount to the user's wallet as a token
        TokenAdapterLike(collateralTokenAdapter).withdraw(msg.sender, amtC);
    }

    function wipeAndFreeFarmableToken(
        address manager,
        address farmableCollateralAdapter,
        address stablecoinAdapter,
        uint cdp,
        uint amtC,
        uint wadD
    ) public {
        address positionAddress = ManagerLike(manager).positions(cdp);
        // Deposits Alpaca Stablecoin amount into the government
        stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, wadD);
        uint wadC = convertTo18(farmableCollateralAdapter, amtC);
        // Paybacks debt to the CDP and unlocks token amount from it
        adjustPosition(
            manager,
            cdp,
            -toInt(wadC),
            _getWipeDebtShare(ManagerLike(manager).government(), GovernmentLike(ManagerLike(manager).government()).stablecoin(positionAddress), positionAddress, ManagerLike(manager).collateralPools(cdp))
        );
        // Moves the amount from the CDP positionAddress to proxy's address
        moveCollateral(manager, cdp, address(this), wadC);
        // Withdraws token amount to the user's wallet as a token
        FarmableTokenAdapterLike(farmableCollateralAdapter).withdraw(positionAddress, msg.sender, amtC);
    }

    function wipeAllAndFreeFarmableToken(
        address manager,
        address farmableCollateralAdapter,
        address stablecoinAdapter,
        uint cdp,
        uint amtC
    ) public {
        address government = ManagerLike(manager).government();
        address positionAddress = ManagerLike(manager).positions(cdp);
        bytes32 collateralPoolId = ManagerLike(manager).collateralPools(cdp);
        (, uint debtShare) = GovernmentLike(government).positions(collateralPoolId, positionAddress);

        // Deposits Alpaca Stablecoin amount into the government
        stablecoinAdapter_deposit(stablecoinAdapter, positionAddress, _getWipeAllWad(government, positionAddress, positionAddress, collateralPoolId));
        uint wadC = convertTo18(farmableCollateralAdapter, amtC);
        // Paybacks debt to the CDP and unlocks token amount from it
        adjustPosition(
            manager,
            cdp,
            -toInt(wadC),
            -int(debtShare)
        );
        // Moves the amount from the CDP positionAddress to proxy's address
        moveCollateral(manager, cdp, address(this), wadC);
        // Withdraws token amount to the user's wallet as a token
        FarmableTokenAdapterLike(farmableCollateralAdapter).withdraw(positionAddress, msg.sender, amtC);
    }
}
