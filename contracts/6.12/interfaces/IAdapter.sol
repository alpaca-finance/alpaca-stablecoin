pragma solidity 0.6.12;

interface IAdapter {
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
    require(collateralToken.transferFrom(msg.sender, address(this), wad), "TokenAdapter/failed-transfer");
  }

  function withdraw(address usr, uint256 wad) external nonReentrant {
    require(wad <= 2**255, "TokenAdapter/overflow");
    government.addCollateral(collateralPoolId, msg.sender, -int256(wad));
    require(collateralToken.transfer(usr, wad), "TokenAdapter/failed-transfer");
  }
}

}
