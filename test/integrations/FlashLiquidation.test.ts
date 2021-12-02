import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import * as TimeHelpers from "../helper/time"
import { MaxUint256 } from "@ethersproject/constants"

import {
  ProxyWalletRegistry__factory,
  ProxyWalletFactory__factory,
  ProxyWalletRegistry,
  BookKeeper__factory,
  PositionManager,
  PositionManager__factory,
  BookKeeper,
  BEP20__factory,
  IbTokenAdapter__factory,
  IbTokenAdapter,
  AlpacaToken__factory,
  FairLaunch__factory,
  Shield__factory,
  BEP20,
  Shield,
  AlpacaToken,
  FairLaunch,
  AlpacaStablecoinProxyActions__factory,
  AlpacaStablecoinProxyActions,
  StabilityFeeCollector__factory,
  StabilityFeeCollector,
  StablecoinAdapter__factory,
  StablecoinAdapter,
  AlpacaStablecoin__factory,
  AlpacaStablecoin,
  ProxyWallet,
  LiquidationEngine__factory,
  LiquidationEngine,
  SystemDebtEngine__factory,
  SystemDebtEngine,
  FixedSpreadLiquidationStrategy__factory,
  FixedSpreadLiquidationStrategy,
  PriceOracle,
  PriceOracle__factory,
  SimplePriceFeed__factory,
  SimplePriceFeed,
  MockFlashLendingCalleeMintable,
  MockFlashLendingCalleeMintable__factory,
  MockFlashLendingCallee,
  MockFlashLendingCallee__factory,
  CollateralPoolConfig,
  CollateralPoolConfig__factory,
  AccessControlConfig__factory,
  AccessControlConfig,
  PCSFlashLiquidator,
  PCSFlashLiquidator__factory,
} from "../../typechain"
import {
  PancakeFactory__factory,
  PancakeFactory,
  PancakePair__factory,
  PancakePair,
  PancakeRouterV2__factory,
  PancakeRouterV2,
  WETH__factory,
  WETH,
  MdexRouter,
  SimpleVaultConfig__factory,
  WNativeRelayer__factory,
  WNativeRelayer,
  Vault__factory,
  DebtToken__factory,
  Vault,
} from "@alpaca-finance/alpaca-contract/typechain"
import { expect } from "chai"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../helper/unit"
import { loadProxyWalletFixtureHandler } from "../helper/proxy"

import * as AssertHelpers from "../helper/assert"
import { AddressZero } from "../helper/address"

const { formatBytes32String } = ethers.utils
const FOREVER = "2000000000"

type fixture = {
  wbnb: WETH
  proxyWalletRegistry: ProxyWalletRegistry
  ibTokenAdapter: IbTokenAdapter
  ibWBNBAdapter: IbTokenAdapter
  stablecoinAdapter: StablecoinAdapter
  bookKeeper: BookKeeper
  dummyToken: BEP20
  shield: Shield
  alpacaToken: AlpacaToken
  fairLaunch: FairLaunch
  bnbVault: Vault
  alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  positionManager: PositionManager
  stabilityFeeCollector: StabilityFeeCollector
  alpacaStablecoin: AlpacaStablecoin
  liquidationEngine: LiquidationEngine
  fixedSpreadLiquidationStrategy: FixedSpreadLiquidationStrategy
  simplePriceFeed: SimplePriceFeed
  systemDebtEngine: SystemDebtEngine
  mockFlashLendingCalleeMintable: MockFlashLendingCalleeMintable
  mockFlashLendingCallee: MockFlashLendingCallee
  collateralPoolConfig: CollateralPoolConfig
  pcsFlashLiquidator: PCSFlashLiquidator
  pancakeRouter: PancakeRouterV2
}

const ALPACA_PER_BLOCK = ethers.utils.parseEther("100")
const COLLATERAL_POOL_ID = formatBytes32String("dummyToken")
const WBNB_COLLATERAL_POOL_ID = formatBytes32String("ibWBNB")
const CLOSE_FACTOR_BPS = BigNumber.from(5000)
const LIQUIDATOR_INCENTIVE_BPS = BigNumber.from(10250)
const TREASURY_FEE_BPS = BigNumber.from(5000)
const BPS = BigNumber.from(10000)

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer, alice, bob, dev] = await ethers.getSigners()

  const ProxyWalletFactory = new ProxyWalletFactory__factory(deployer)
  const proxyWalletFactory = await ProxyWalletFactory.deploy()

  const ProxyWalletRegistry = new ProxyWalletRegistry__factory(deployer)
  const proxyWalletRegistry = (await upgrades.deployProxy(ProxyWalletRegistry, [
    proxyWalletFactory.address,
  ])) as ProxyWalletRegistry

  const AccessControlConfig = (await ethers.getContractFactory(
    "AccessControlConfig",
    deployer
  )) as AccessControlConfig__factory
  const accessControlConfig = (await upgrades.deployProxy(AccessControlConfig, [])) as AccessControlConfig

  const CollateralPoolConfig = (await ethers.getContractFactory(
    "CollateralPoolConfig",
    deployer
  )) as CollateralPoolConfig__factory
  const collateralPoolConfig = (await upgrades.deployProxy(CollateralPoolConfig, [
    accessControlConfig.address,
  ])) as CollateralPoolConfig

  // Deploy mocked BookKeeper
  const BookKeeper = (await ethers.getContractFactory("BookKeeper", deployer)) as BookKeeper__factory
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [
    collateralPoolConfig.address,
    accessControlConfig.address,
  ])) as BookKeeper
  await bookKeeper.deployed()

  await accessControlConfig.grantRole(await accessControlConfig.BOOK_KEEPER_ROLE(), bookKeeper.address)

  const SimplePriceFeed = (await ethers.getContractFactory("SimplePriceFeed", deployer)) as SimplePriceFeed__factory
  const simplePriceFeed = (await upgrades.deployProxy(SimplePriceFeed, [
    accessControlConfig.address,
  ])) as SimplePriceFeed
  await simplePriceFeed.deployed()

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const dummyToken = await BEP20.deploy("dummyToken", "dummyToken")
  await dummyToken.deployed()
  await dummyToken.mint(await alice.getAddress(), ethers.utils.parseEther("1000000"))
  await dummyToken.mint(await bob.getAddress(), ethers.utils.parseEther("100"))

  // Deploy Alpaca's Fairlaunch
  const AlpacaToken = (await ethers.getContractFactory("AlpacaToken", deployer)) as AlpacaToken__factory
  const alpacaToken = await AlpacaToken.deploy(88, 89)
  await alpacaToken.mint(await deployer.getAddress(), ethers.utils.parseEther("150"))
  await alpacaToken.deployed()

  const WBNB = new WETH__factory(deployer)
  const wbnb = await WBNB.deploy()
  await wbnb.deployed()

  const WNativeRelayer = new WNativeRelayer__factory(deployer)
  const wNativeRelayer = (await WNativeRelayer.deploy(wbnb.address)) as WNativeRelayer
  await wNativeRelayer.deployed()

  const DebtToken = new DebtToken__factory(deployer)
  const debtToken = await DebtToken.deploy()
  await debtToken.deployed()
  await debtToken.initialize("debtibBTOKEN_V2", "debtibBTOKEN_V2", deployer.address)

  const FairLaunch = (await ethers.getContractFactory("FairLaunch", deployer)) as FairLaunch__factory
  const fairLaunch = await FairLaunch.deploy(alpacaToken.address, await dev.getAddress(), ALPACA_PER_BLOCK, 0, 0, 0)
  await fairLaunch.deployed()

  const Shield = (await ethers.getContractFactory("Shield", deployer)) as Shield__factory
  const shield = await Shield.deploy(deployer.address, fairLaunch.address)
  await shield.deployed()

  const RESERVE_POOL_BPS = "1000" // 10% reserve pool
  const KILL_PRIZE_BPS = "1000" // 10% Kill prize
  const INTEREST_RATE = "3472222222222" // 30% per year
  const MIN_DEBT_SIZE = ethers.utils.parseEther("1") // 1 BTOKEN min debt size
  const KILL_TREASURY_BPS = "100"

  const SimpleVaultConfig = new SimpleVaultConfig__factory(deployer)
  const simpleVaultConfig = await SimpleVaultConfig.deploy()
  await simpleVaultConfig.deployed()
  await simpleVaultConfig.initialize(
    MIN_DEBT_SIZE,
    INTEREST_RATE,
    RESERVE_POOL_BPS,
    KILL_PRIZE_BPS,
    wbnb.address,
    wNativeRelayer.address,
    fairLaunch.address,
    KILL_TREASURY_BPS,
    deployer.address
  )

  const Vault = new Vault__factory(deployer)
  // const tokenVault = await Vault.deploy()
  // await tokenVault.deployed()
  // await tokenVault.initialize(
  //   simpleVaultConfig.address,
  //   baseToken.address,
  //   "Interest Bearing BTOKEN",
  //   "ibBTOKEN",
  //   18,
  //   debtToken.address
  // )

  const bnbVault = await Vault.deploy()
  await bnbVault.deployed()
  await bnbVault.initialize(
    simpleVaultConfig.address,
    wbnb.address,
    "Interest Bearing BNB",
    "ibBNB",
    18,
    debtToken.address
  )

  await wNativeRelayer.setCallerOk([bnbVault.address], true)

  // Config Alpaca's FairLaunch
  // Assuming Deployer is timelock for easy testing
  await fairLaunch.addPool(1, dummyToken.address, true)
  await fairLaunch.addPool(1, bnbVault.address, true)
  await fairLaunch.transferOwnership(shield.address)
  await shield.transferOwnership(await deployer.getAddress())
  await alpacaToken.transferOwnership(fairLaunch.address)

  // Deploy PositionManager
  const PositionManager = (await ethers.getContractFactory("PositionManager", deployer)) as PositionManager__factory
  const positionManager = (await upgrades.deployProxy(PositionManager, [
    bookKeeper.address,
    bookKeeper.address,
  ])) as PositionManager
  await positionManager.deployed()
  await accessControlConfig.grantRole(await accessControlConfig.POSITION_MANAGER_ROLE(), positionManager.address)
  await accessControlConfig.grantRole(await accessControlConfig.COLLATERAL_MANAGER_ROLE(), positionManager.address)

  const IbTokenAdapter = (await ethers.getContractFactory("IbTokenAdapter", deployer)) as IbTokenAdapter__factory
  const ibTokenAdapter = (await upgrades.deployProxy(IbTokenAdapter, [
    bookKeeper.address,
    COLLATERAL_POOL_ID,
    dummyToken.address,
    alpacaToken.address,
    fairLaunch.address,
    0,
    shield.address,
    await deployer.getAddress(),
    BigNumber.from(1000),
    await dev.getAddress(),
    positionManager.address,
  ])) as IbTokenAdapter
  await ibTokenAdapter.deployed()

  const ibWBNBAdapter = (await upgrades.deployProxy(IbTokenAdapter, [
    bookKeeper.address,
    WBNB_COLLATERAL_POOL_ID,
    bnbVault.address,
    alpacaToken.address,
    fairLaunch.address,
    1,
    shield.address,
    await deployer.getAddress(),
    BigNumber.from(1000),
    await dev.getAddress(),
    positionManager.address,
  ])) as IbTokenAdapter
  await ibTokenAdapter.deployed()

  await collateralPoolConfig.initCollateralPool(
    COLLATERAL_POOL_ID,
    WeiPerRad.mul(10000000),
    0,
    simplePriceFeed.address,
    WeiPerRay,
    WeiPerRay,
    ibTokenAdapter.address,
    CLOSE_FACTOR_BPS,
    LIQUIDATOR_INCENTIVE_BPS,
    TREASURY_FEE_BPS,
    AddressZero
  )
  await collateralPoolConfig.initCollateralPool(
    WBNB_COLLATERAL_POOL_ID,
    WeiPerRad.mul(10000000),
    0,
    simplePriceFeed.address,
    WeiPerRay,
    WeiPerRay,
    ibWBNBAdapter.address,
    CLOSE_FACTOR_BPS,
    LIQUIDATOR_INCENTIVE_BPS,
    TREASURY_FEE_BPS,
    AddressZero
  )
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10000000))

  await accessControlConfig.grantRole(await accessControlConfig.PRICE_ORACLE_ROLE(), deployer.address)
  await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

  await accessControlConfig.grantRole(
    ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]),
    ibTokenAdapter.address
  )
  await accessControlConfig.grantRole(
    ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]),
    ibWBNBAdapter.address
  )
  await accessControlConfig.grantRole(await accessControlConfig.MINTABLE_ROLE(), deployer.address)

  // Deploy Alpaca Stablecoin
  const AlpacaStablecoin = (await ethers.getContractFactory("AlpacaStablecoin", deployer)) as AlpacaStablecoin__factory
  const alpacaStablecoin = (await upgrades.deployProxy(AlpacaStablecoin, ["Alpaca USD", "AUSD"])) as AlpacaStablecoin
  await alpacaStablecoin.deployed()

  const StablecoinAdapter = (await ethers.getContractFactory(
    "StablecoinAdapter",
    deployer
  )) as StablecoinAdapter__factory
  const stablecoinAdapter = (await upgrades.deployProxy(StablecoinAdapter, [
    bookKeeper.address,
    alpacaStablecoin.address,
  ])) as StablecoinAdapter
  await stablecoinAdapter.deployed()
  await bookKeeper.whitelist(stablecoinAdapter.address)

  await alpacaStablecoin.grantRole(await alpacaStablecoin.MINTER_ROLE(), stablecoinAdapter.address)

  const AlpacaStablecoinProxyActions = new AlpacaStablecoinProxyActions__factory(deployer)
  const alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions = await AlpacaStablecoinProxyActions.deploy()

  const SystemDebtEngine = (await ethers.getContractFactory("SystemDebtEngine", deployer)) as SystemDebtEngine__factory
  const systemDebtEngine = (await upgrades.deployProxy(SystemDebtEngine, [bookKeeper.address])) as SystemDebtEngine

  // Deploy StabilityFeeCollector
  const StabilityFeeCollector = (await ethers.getContractFactory(
    "StabilityFeeCollector",
    deployer
  )) as StabilityFeeCollector__factory
  const stabilityFeeCollector = (await upgrades.deployProxy(StabilityFeeCollector, [
    bookKeeper.address,
    systemDebtEngine.address,
  ])) as StabilityFeeCollector
  await stabilityFeeCollector.setSystemDebtEngine(systemDebtEngine.address)
  await accessControlConfig.grantRole(
    await accessControlConfig.STABILITY_FEE_COLLECTOR_ROLE(),
    stabilityFeeCollector.address
  )
  await accessControlConfig.grantRole(
    await accessControlConfig.STABILITY_FEE_COLLECTOR_ROLE(),
    stabilityFeeCollector.address
  )

  const LiquidationEngine = (await ethers.getContractFactory(
    "LiquidationEngine",
    deployer
  )) as LiquidationEngine__factory
  const liquidationEngine = (await upgrades.deployProxy(LiquidationEngine, [
    bookKeeper.address,
    systemDebtEngine.address,
  ])) as LiquidationEngine

  const PriceOracle = (await ethers.getContractFactory("PriceOracle", deployer)) as PriceOracle__factory
  const priceOracle = (await upgrades.deployProxy(PriceOracle, [bookKeeper.address])) as PriceOracle

  const FixedSpreadLiquidationStrategy = (await ethers.getContractFactory(
    "FixedSpreadLiquidationStrategy",
    deployer
  )) as FixedSpreadLiquidationStrategy__factory
  const fixedSpreadLiquidationStrategy = (await upgrades.deployProxy(FixedSpreadLiquidationStrategy, [
    bookKeeper.address,
    priceOracle.address,
    liquidationEngine.address,
    systemDebtEngine.address,
  ])) as FixedSpreadLiquidationStrategy
  await collateralPoolConfig.setStrategy(COLLATERAL_POOL_ID, fixedSpreadLiquidationStrategy.address)
  await collateralPoolConfig.setStrategy(WBNB_COLLATERAL_POOL_ID, fixedSpreadLiquidationStrategy.address)
  await fixedSpreadLiquidationStrategy.setFlashLendingEnabled(1)
  await accessControlConfig.grantRole(await accessControlConfig.LIQUIDATION_ENGINE_ROLE(), liquidationEngine.address)
  await accessControlConfig.grantRole(
    await accessControlConfig.LIQUIDATION_ENGINE_ROLE(),
    fixedSpreadLiquidationStrategy.address
  )
  await accessControlConfig.grantRole(
    await accessControlConfig.COLLATERAL_MANAGER_ROLE(),
    fixedSpreadLiquidationStrategy.address
  )

  const MockFlashLendingCalleeMintable = (await ethers.getContractFactory(
    "MockFlashLendingCalleeMintable",
    deployer
  )) as MockFlashLendingCalleeMintable__factory
  const mockFlashLendingCalleeMintable = (await upgrades.deployProxy(MockFlashLendingCalleeMintable, [
    bookKeeper.address,
  ])) as MockFlashLendingCalleeMintable
  await accessControlConfig.grantRole(await accessControlConfig.MINTABLE_ROLE(), mockFlashLendingCalleeMintable.address)
  await accessControlConfig.grantRole(
    await accessControlConfig.COLLATERAL_MANAGER_ROLE(),
    mockFlashLendingCalleeMintable.address
  )

  const MockFlashLendingCallee = (await ethers.getContractFactory(
    "MockFlashLendingCallee",
    deployer
  )) as MockFlashLendingCallee__factory
  const mockFlashLendingCallee = (await upgrades.deployProxy(MockFlashLendingCallee, [])) as MockFlashLendingCallee

  // Deploy mocked BEP20
  const BUSD = await BEP20.deploy("BUSD", "BUSD")
  await BUSD.deployed()

  // Setup Pancakeswap
  const PancakeFactoryV2 = new PancakeFactory__factory(deployer)
  const factoryV2 = await PancakeFactoryV2.deploy(await deployer.getAddress())
  await factoryV2.deployed()

  const PancakeRouterV2 = new PancakeRouterV2__factory(deployer)
  const routerV2 = await PancakeRouterV2.deploy(factoryV2.address, wbnb.address)
  await routerV2.deployed()

  /// Setup BUSD-AUSD pair on Pancakeswap
  await factoryV2.createPair(BUSD.address, alpacaStablecoin.address)
  await factoryV2.createPair(wbnb.address, alpacaStablecoin.address)
  const lpV2 = PancakePair__factory.connect(await factoryV2.getPair(BUSD.address, alpacaStablecoin.address), deployer)
  await lpV2.deployed()

  const PCSFlashLiquidator = (await ethers.getContractFactory(
    "PCSFlashLiquidator",
    deployer
  )) as PCSFlashLiquidator__factory
  const pcsFlashLiquidator = (await upgrades.deployProxy(PCSFlashLiquidator, [
    bookKeeper.address,
    alpacaStablecoin.address,
    stablecoinAdapter.address,
    wbnb.address,
  ])) as PCSFlashLiquidator

  await pcsFlashLiquidator.whitelist(liquidationEngine.address)
  await pcsFlashLiquidator.whitelist(fixedSpreadLiquidationStrategy.address)
  await pcsFlashLiquidator.whitelist(stablecoinAdapter.address)

  return {
    wbnb,
    proxyWalletRegistry,
    ibTokenAdapter,
    ibWBNBAdapter,
    stablecoinAdapter,
    bookKeeper,
    dummyToken,
    shield,
    alpacaToken,
    bnbVault,
    fairLaunch,
    alpacaStablecoinProxyActions,
    positionManager,
    stabilityFeeCollector,
    alpacaStablecoin,
    liquidationEngine,
    fixedSpreadLiquidationStrategy,
    simplePriceFeed,
    systemDebtEngine,
    mockFlashLendingCalleeMintable,
    mockFlashLendingCallee,
    collateralPoolConfig,
    pcsFlashLiquidator,
    pancakeRouter: routerV2,
  }
}

describe("FlashLiquidation", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer
  let bob: Signer
  let dev: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string
  let bobAddress: string
  let devAddress: string

  // Contracts
  let proxyWalletRegistry: ProxyWalletRegistry

  let proxyWalletRegistryAsAlice: ProxyWalletRegistry
  let proxyWalletRegistryAsBob: ProxyWalletRegistry

  let deployerProxyWallet: ProxyWallet
  let aliceProxyWallet: ProxyWallet

  let wbnb: WETH
  let ibTokenAdapter: IbTokenAdapter
  let ibWBNBAdapter: IbTokenAdapter
  let stablecoinAdapter: StablecoinAdapter
  let bookKeeper: BookKeeper
  let dummyToken: BEP20
  let shield: Shield
  let alpacaToken: AlpacaToken
  let fairLaunch: FairLaunch
  let bnbVault: Vault

  let positionManager: PositionManager

  let stabilityFeeCollector: StabilityFeeCollector

  let liquidationEngine: LiquidationEngine
  let fixedSpreadLiquidationStrategy: FixedSpreadLiquidationStrategy

  let alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions

  let alpacaStablecoin: AlpacaStablecoin

  let simplePriceFeed: SimplePriceFeed

  let systemDebtEngine: SystemDebtEngine

  let mockFlashLendingCalleeMintable: MockFlashLendingCalleeMintable
  let mockFlashLendingCallee: MockFlashLendingCallee

  let collateralPoolConfig: CollateralPoolConfig

  let pcsFlashLiquidator: PCSFlashLiquidator

  let pancakeRouter: PancakeRouterV2

  // Signer
  let ibTokenAdapterAsAlice: IbTokenAdapter
  let ibTokenAdapterAsBob: IbTokenAdapter

  let dummyTokenasAlice: BEP20
  let bnbVaultasAlice: BEP20
  let dummyTokenasBob: BEP20

  let liquidationEngineAsBob: LiquidationEngine

  let simplePriceFeedAsDeployer: SimplePriceFeed

  let bookKeeperAsBob: BookKeeper

  before(async () => {
    ;({
      proxyWallets: [deployerProxyWallet, aliceProxyWallet],
    } = await waffle.loadFixture(loadProxyWalletFixtureHandler))
  })

  beforeEach(async () => {
    ;({
      wbnb,
      proxyWalletRegistry,
      ibTokenAdapter,
      ibWBNBAdapter,
      stablecoinAdapter,
      bookKeeper,
      dummyToken,
      shield,
      alpacaToken,
      bnbVault,
      fairLaunch,
      alpacaStablecoinProxyActions,
      positionManager,
      stabilityFeeCollector,
      alpacaStablecoin,
      liquidationEngine,
      fixedSpreadLiquidationStrategy,
      simplePriceFeed,
      systemDebtEngine,
      mockFlashLendingCalleeMintable,
      mockFlashLendingCallee,
      collateralPoolConfig,
      pcsFlashLiquidator,
      pancakeRouter,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])
    proxyWalletRegistryAsAlice = ProxyWalletRegistry__factory.connect(proxyWalletRegistry.address, alice)
    proxyWalletRegistryAsBob = ProxyWalletRegistry__factory.connect(proxyWalletRegistry.address, bob)

    ibTokenAdapterAsAlice = IbTokenAdapter__factory.connect(ibTokenAdapter.address, alice)
    ibTokenAdapterAsBob = IbTokenAdapter__factory.connect(ibTokenAdapter.address, bob)

    dummyTokenasAlice = BEP20__factory.connect(dummyToken.address, alice)
    bnbVaultasAlice = BEP20__factory.connect(bnbVault.address, alice)
    dummyTokenasBob = BEP20__factory.connect(dummyToken.address, bob)

    liquidationEngineAsBob = LiquidationEngine__factory.connect(liquidationEngine.address, bob)

    simplePriceFeedAsDeployer = SimplePriceFeed__factory.connect(simplePriceFeed.address, deployer)

    bookKeeperAsBob = BookKeeper__factory.connect(bookKeeper.address, bob)
  })

  describe("#liquidate with MockFlashLiquidator", async () => {
    context("safety buffer -0.1%, but liquidator does not have enough AUSD to liquidate", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for dummyToken to 2 USD
        await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 dummyToken and draw 1 AUSD
        const lockedCollateralAmount = WeiPerWad
        const drawStablecoinAmount = WeiPerWad
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await dummyTokenasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 dummyToken, because Alice locked 1 dummyToken"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 dummyToken, because Alice locked all dummyToken into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. dummyToken price drop to 0.99 USD
        await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.sub(1))
        await simplePriceFeedAsDeployer.setPrice(WeiPerRay.sub(1).div(1e9))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = ethers.utils.parseEther("0.5")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)

        await expect(
          liquidationEngineAsBob.liquidate(
            COLLATERAL_POOL_ID,
            alicePositionAddress,
            debtShareToRepay,
            debtShareToRepay,
            mockFlashLendingCallee.address,
            ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
          )
        ).to.be.reverted
      })
    })

    context("safety buffer -0.1%, position is liquidated up to full close factor with flash liquidation", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for dummyToken to 2 USD
        await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 dummyToken and draw 1 AUSD
        const lockedCollateralAmount = WeiPerWad
        const drawStablecoinAmount = WeiPerWad
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await dummyTokenasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 dummyToken, because Alice locked 1 dummyToken"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 dummyToken, because Alice locked all dummyToken into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. dummyToken price drop to 0.99 USD
        await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.sub(1))
        await simplePriceFeedAsDeployer.setPrice(WeiPerRay.sub(1).div(1e9))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = ethers.utils.parseEther("0.5")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        const expectedSeizedCollateral = debtShareToRepay.mul(LIQUIDATOR_INCENTIVE_BPS).div(BPS)
        const expectedLiquidatorIncentive = expectedSeizedCollateral.sub(
          expectedSeizedCollateral.mul(BPS).div(LIQUIDATOR_INCENTIVE_BPS)
        )
        const expectedTreasuryFee = expectedLiquidatorIncentive.mul(TREASURY_FEE_BPS).div(BPS)
        const expectedCollateralBobShouldReceive = expectedSeizedCollateral.sub(expectedTreasuryFee)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          debtShareToRepay,
          mockFlashLendingCalleeMintable.address,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes32"], [bobAddress, COLLATERAL_POOL_ID])
        )

        // 5. Settle system bad debt
        await systemDebtEngine.settleSystemBadDebt(debtShareToRepay.mul(WeiPerRay))

        const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)
        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
        expect(
          alicePositionAfterLiquidation.lockedCollateral,
          "lockedCollateral should be 0.4875 dummyToken after including liquidator incentive and treasury fee"
        )
          .to.be.equal(lockedCollateralAmount.sub(expectedSeizedCollateral))
          .to.be.equal(ethers.utils.parseEther("0.4875"))
        expect(
          alicePositionAfterLiquidation.debtShare,
          "debtShare should be 0.5 AUSD, because Bob liquidated 0.5 AUSD from Alice's position"
        )
          .to.be.equal(alicePosition.debtShare.sub(debtShareToRepay))
          .to.be.equal(ethers.utils.parseEther("0.5"))
        expect(
          await bookKeeper.systemBadDebt(systemDebtEngine.address),
          "System bad debt should be 0 AUSD"
        ).to.be.equal(0)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress),
          "Bob should receive 0.50625 dummyToken"
        )
          .to.be.equal(expectedCollateralBobShouldReceive)
          .to.be.equal(ethers.utils.parseEther("0.50625"))
        expect(
          bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation),
          "Bob should pay 0.5 AUSD for this liquidation"
        ).to.be.equal(ethers.utils.parseEther("0.5").mul(WeiPerRay))
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address),
          "SystemDebtEngine should receive 0.00625 dummyToken as treasury fee"
        )
          .to.be.equal(expectedTreasuryFee)
          .to.be.equal(ethers.utils.parseEther("0.00625"))
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
        ).to.not.equal(0)
      })
    })
  })

  describe("#liquidate with PCSFlashLiquidator", async () => {
    context(
      "safety buffer -0.1%, position is liquidated up to full close factor with flash liquidation; AUSD is obtained by swapping at PancakeSwap",
      async () => {
        it("should success", async () => {
          // 1. Set priceWithSafetyMargin for dummyToken to 2 USD
          await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

          // 2. Alice open a new position with 1 dummyToken and draw 1 AUSD
          const lockedCollateralAmount = WeiPerWad
          const drawStablecoinAmount = WeiPerWad
          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            COLLATERAL_POOL_ID,
            lockedCollateralAmount,
            drawStablecoinAmount,
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await dummyTokenasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
          const alicePositionAddress = await positionManager.positions(1)
          const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
          const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

          expect(
            alicePosition.lockedCollateral,
            "lockedCollateral should be 1 dummyToken, because Alice locked 1 dummyToken"
          ).to.be.equal(WeiPerWad)
          expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
            WeiPerWad
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 dummyToken, because Alice locked all dummyToken into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
          expect(
            await alpacaToken.balanceOf(aliceProxyWallet.address),
            "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
          ).to.be.equal(0)

          // 3. dummyToken price drop to 0.99 USD
          await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.sub(1))
          await simplePriceFeedAsDeployer.setPrice(WeiPerRay.sub(1).div(1e9))

          // 4. Bob liquidate Alice's position up to full close factor successfully
          const debtShareToRepay = ethers.utils.parseEther("0.5")
          await bookKeeperAsBob.whitelist(liquidationEngine.address)
          await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
          await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
          const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
          const expectedSeizedCollateral = debtShareToRepay.mul(LIQUIDATOR_INCENTIVE_BPS).div(BPS)
          const expectedLiquidatorIncentive = expectedSeizedCollateral.sub(
            expectedSeizedCollateral.mul(BPS).div(LIQUIDATOR_INCENTIVE_BPS)
          )
          const expectedTreasuryFee = expectedLiquidatorIncentive.mul(TREASURY_FEE_BPS).div(BPS)
          const expectedCollateralBobShouldReceive = expectedSeizedCollateral.sub(expectedTreasuryFee)

          await bookKeeper.mintUnbackedStablecoin(
            deployerAddress,
            deployerAddress,
            ethers.utils.parseEther("1000").mul(WeiPerRay)
          )
          await stablecoinAdapter.withdraw(deployerAddress, ethers.utils.parseEther("1000"), "0x")
          await dummyToken.mint(deployerAddress, ethers.utils.parseEther("1000"))

          await dummyToken.approve(pancakeRouter.address, ethers.utils.parseEther("1000"))
          await alpacaStablecoin.approve(pancakeRouter.address, ethers.utils.parseEther("1000"))
          await pancakeRouter.addLiquidity(
            dummyToken.address,
            alpacaStablecoin.address,
            ethers.utils.parseEther("1000"),
            ethers.utils.parseEther("1000"),
            "0",
            "0",
            deployerAddress,
            FOREVER
          )

          const expectedAmountOut = await pancakeRouter.getAmountOut(
            expectedCollateralBobShouldReceive,
            ethers.utils.parseEther("1000"),
            ethers.utils.parseEther("1000")
          )
          const expectedProfitFromLiquidation = expectedAmountOut.sub(debtShareToRepay.add(1))

          await liquidationEngineAsBob.liquidate(
            COLLATERAL_POOL_ID,
            alicePositionAddress,
            debtShareToRepay,
            debtShareToRepay,
            pcsFlashLiquidator.address,
            ethers.utils.defaultAbiCoder.encode(
              ["address", "address", "address", "address", "address[]"],
              [
                bobAddress,
                ibTokenAdapter.address,
                AddressZero,
                pancakeRouter.address,
                [dummyToken.address, alpacaStablecoin.address],
              ]
            )
          )

          // 5. Settle system bad debt
          await systemDebtEngine.settleSystemBadDebt(debtShareToRepay.mul(WeiPerRay))

          const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)
          const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          expect(
            alicePositionAfterLiquidation.lockedCollateral,
            "lockedCollateral should be 0.4875 dummyToken after including liquidator incentive and treasury fee"
          )
            .to.be.equal(lockedCollateralAmount.sub(expectedSeizedCollateral))
            .to.be.equal(ethers.utils.parseEther("0.4875"))
          expect(
            alicePositionAfterLiquidation.debtShare,
            "debtShare should be 0.5 AUSD, because Bob liquidated 0.5 AUSD from Alice's position"
          )
            .to.be.equal(alicePosition.debtShare.sub(debtShareToRepay))
            .to.be.equal(ethers.utils.parseEther("0.5"))
          expect(
            await bookKeeper.systemBadDebt(systemDebtEngine.address),
            "System bad debt should be 0 AUSD"
          ).to.be.equal(0)
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress),
            "Bob should not receive dummyToken, because Bob use flash liquidation to sell all of them"
          ).to.be.equal(ethers.utils.parseEther("0"))
          expect(
            bobStablecoinAfterLiquidation.sub(bobStablecoinBeforeLiquidation),
            "Bob should pay 0 AUSD for this liquidation due to using flash liquidation with PCS"
          ).to.be.gte(0)
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address),
            "SystemDebtEngine should receive 0.00625 dummyToken as treasury fee"
          )
            .to.be.equal(expectedTreasuryFee)
            .to.be.equal(ethers.utils.parseEther("0.00625"))
          expect(
            await alpacaToken.balanceOf(aliceProxyWallet.address),
            "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
          ).to.not.equal(0)

          const alpacaStablecoinBalanceBefore = await alpacaStablecoin.balanceOf(deployerAddress)
          await pcsFlashLiquidator.withdrawToken(
            alpacaStablecoin.address,
            await alpacaStablecoin.balanceOf(pcsFlashLiquidator.address)
          )
          const alpacaStablecoinBalanceAfter = await alpacaStablecoin.balanceOf(deployerAddress)
          expect(
            alpacaStablecoinBalanceAfter.sub(alpacaStablecoinBalanceBefore),
            "Flash Liquidation profit should be 0.004729494491680053 AUSD"
          ).to.be.equal(expectedProfitFromLiquidation)
        })
      }
    )
    context(
      "(BNB Pool) safety buffer -0.1%, position is liquidated up to full close factor with flash liquidation; AUSD is obtained by swapping at PancakeSwap",
      async () => {
        it("should success", async () => {
          // 1. Set priceWithSafetyMargin for wbnb to 2 USD
          await collateralPoolConfig.setPriceWithSafetyMargin(WBNB_COLLATERAL_POOL_ID, WeiPerRay.mul(2))
          // 2. Alice open a new position with 1 wbnb and draw 1 AUSD
          const lockedCollateralAmount = WeiPerWad
          const drawStablecoinAmount = WeiPerWad

          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "convertBNBOpenLockTokenAndDraw",
            [
              bnbVault.address,
              positionManager.address,
              stabilityFeeCollector.address,
              ibWBNBAdapter.address,
              stablecoinAdapter.address,
              WBNB_COLLATERAL_POOL_ID,
              drawStablecoinAmount,
              true,
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )

          await bnbVaultasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall, {
            value: lockedCollateralAmount,
          })
          const alicePositionAddress = await positionManager.positions(1)
          const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
          const alicePosition = await bookKeeper.positions(WBNB_COLLATERAL_POOL_ID, alicePositionAddress)
          expect(
            alicePosition.lockedCollateral,
            "lockedCollateral should be 1 wbnb, because Alice locked 1 wbnb"
          ).to.be.equal(WeiPerWad)
          expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
            WeiPerWad
          )
          expect(
            await bookKeeper.collateralToken(WBNB_COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 wbnb, because Alice locked all wbnb into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
          expect(
            await alpacaToken.balanceOf(aliceProxyWallet.address),
            "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
          ).to.be.equal(0)

          // 3. wbnb price drop to 0.99 USD
          await collateralPoolConfig.setPriceWithSafetyMargin(WBNB_COLLATERAL_POOL_ID, WeiPerRay.sub(1))
          await simplePriceFeedAsDeployer.setPrice(WeiPerRay.sub(1).div(1e9))
          // 4. Bob liquidate Alice's position up to full close factor successfully
          const debtShareToRepay = ethers.utils.parseEther("0.5")
          await bookKeeperAsBob.whitelist(liquidationEngine.address)
          await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
          await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
          const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
          const expectedSeizedCollateral = debtShareToRepay.mul(LIQUIDATOR_INCENTIVE_BPS).div(BPS)
          const expectedLiquidatorIncentive = expectedSeizedCollateral.sub(
            expectedSeizedCollateral.mul(BPS).div(LIQUIDATOR_INCENTIVE_BPS)
          )
          const expectedTreasuryFee = expectedLiquidatorIncentive.mul(TREASURY_FEE_BPS).div(BPS)
          const expectedCollateralBobShouldReceive = expectedSeizedCollateral.sub(expectedTreasuryFee)

          await bookKeeper.mintUnbackedStablecoin(
            deployerAddress,
            deployerAddress,
            ethers.utils.parseEther("1000").mul(WeiPerRay)
          )
          await stablecoinAdapter.withdraw(deployerAddress, ethers.utils.parseEther("1000"), "0x")
          await wbnb.deposit({ value: ethers.utils.parseEther("1000") })
          await wbnb.approve(pancakeRouter.address, ethers.utils.parseEther("1000"))
          await alpacaStablecoin.approve(pancakeRouter.address, ethers.utils.parseEther("1000"))
          await pancakeRouter.addLiquidity(
            wbnb.address,
            alpacaStablecoin.address,
            ethers.utils.parseEther("1000"),
            ethers.utils.parseEther("1000"),
            "0",
            "0",
            deployerAddress,
            FOREVER
          )
          const expectedAmountOut = await pancakeRouter.getAmountOut(
            expectedCollateralBobShouldReceive,
            ethers.utils.parseEther("1000"),
            ethers.utils.parseEther("1000")
          )
          const expectedProfitFromLiquidation = expectedAmountOut.sub(debtShareToRepay.add(1))
          await liquidationEngineAsBob.liquidate(
            WBNB_COLLATERAL_POOL_ID,
            alicePositionAddress,
            debtShareToRepay,
            debtShareToRepay,
            pcsFlashLiquidator.address,
            ethers.utils.defaultAbiCoder.encode(
              ["address", "address", "address", "address", "address[]"],
              [
                bobAddress,
                ibWBNBAdapter.address,
                bnbVault.address,
                pancakeRouter.address,
                [wbnb.address, alpacaStablecoin.address],
              ]
            )
          )
          // 5. Settle system bad debt
          await systemDebtEngine.settleSystemBadDebt(debtShareToRepay.mul(WeiPerRay))

          const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)
          const alicePositionAfterLiquidation = await bookKeeper.positions(
            WBNB_COLLATERAL_POOL_ID,
            alicePositionAddress
          )
          expect(
            alicePositionAfterLiquidation.lockedCollateral,
            "lockedCollateral should be 0.4875 wbnb after including liquidator incentive and treasury fee"
          )
            .to.be.equal(lockedCollateralAmount.sub(expectedSeizedCollateral))
            .to.be.equal(ethers.utils.parseEther("0.4875"))
          expect(
            alicePositionAfterLiquidation.debtShare,
            "debtShare should be 0.5 AUSD, because Bob liquidated 0.5 AUSD from Alice's position"
          )
            .to.be.equal(alicePosition.debtShare.sub(debtShareToRepay))
            .to.be.equal(ethers.utils.parseEther("0.5"))
          expect(
            await bookKeeper.systemBadDebt(systemDebtEngine.address),
            "System bad debt should be 0 AUSD"
          ).to.be.equal(0)
          expect(
            await bookKeeper.collateralToken(WBNB_COLLATERAL_POOL_ID, bobAddress),
            "Bob should not receive wbnb, because Bob use flash liquidation to sell all of them"
          ).to.be.equal(ethers.utils.parseEther("0"))
          expect(
            bobStablecoinAfterLiquidation.sub(bobStablecoinBeforeLiquidation),
            "Bob should pay 0 AUSD for this liquidation due to using flash liquidation with PCS"
          ).to.be.gte(0)
          expect(
            await bookKeeper.collateralToken(WBNB_COLLATERAL_POOL_ID, systemDebtEngine.address),
            "SystemDebtEngine should receive 0.00625 wbnb as treasury fee"
          )
            .to.be.equal(expectedTreasuryFee)
            .to.be.equal(ethers.utils.parseEther("0.00625"))
          expect(
            await alpacaToken.balanceOf(aliceProxyWallet.address),
            "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
          ).to.not.equal(0)

          const alpacaStablecoinBalanceBefore = await alpacaStablecoin.balanceOf(deployerAddress)
          await pcsFlashLiquidator.withdrawToken(
            alpacaStablecoin.address,
            await alpacaStablecoin.balanceOf(pcsFlashLiquidator.address)
          )
          const alpacaStablecoinBalanceAfter = await alpacaStablecoin.balanceOf(deployerAddress)
          expect(
            alpacaStablecoinBalanceAfter.sub(alpacaStablecoinBalanceBefore),
            "Flash Liquidation profit should be 0.004729494491680053 AUSD"
          ).to.be.equal(expectedProfitFromLiquidation)
        })
      }
    )
    context(
      "safety buffer -0.1%, position is liquidated up to full close factor with flash liquidation; AUSD is obtained by swapping at PancakeSwap, but result into not enough AUSD to repay debt",
      async () => {
        it("should revert", async () => {
          // 1. Set priceWithSafetyMargin for dummyToken to 2 USD
          await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

          // 2. Alice open a new position with 1 dummyToken and draw 1 AUSD
          const lockedCollateralAmount = WeiPerWad
          const drawStablecoinAmount = WeiPerWad
          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            COLLATERAL_POOL_ID,
            lockedCollateralAmount,
            drawStablecoinAmount,
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await dummyTokenasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
          const alicePositionAddress = await positionManager.positions(1)
          const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
          const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

          expect(
            alicePosition.lockedCollateral,
            "lockedCollateral should be 1 dummyToken, because Alice locked 1 dummyToken"
          ).to.be.equal(WeiPerWad)
          expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
            WeiPerWad
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 dummyToken, because Alice locked all dummyToken into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
          expect(
            await alpacaToken.balanceOf(aliceProxyWallet.address),
            "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
          ).to.be.equal(0)

          // 3. dummyToken price drop to 0.99 USD
          await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.sub(1))
          await simplePriceFeedAsDeployer.setPrice(WeiPerRay.sub(1).div(1e9))

          // 4. Bob liquidate Alice's position up to full close factor successfully
          const debtShareToRepay = ethers.utils.parseEther("0.5")
          await bookKeeperAsBob.whitelist(liquidationEngine.address)
          await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
          await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
          const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
          const expectedSeizedCollateral = debtShareToRepay.mul(LIQUIDATOR_INCENTIVE_BPS).div(BPS)
          const expectedLiquidatorIncentive = expectedSeizedCollateral.sub(
            expectedSeizedCollateral.mul(BPS).div(LIQUIDATOR_INCENTIVE_BPS)
          )
          const expectedTreasuryFee = expectedLiquidatorIncentive.mul(TREASURY_FEE_BPS).div(BPS)
          const expectedCollateralBobShouldReceive = expectedSeizedCollateral.sub(expectedTreasuryFee)

          await bookKeeper.mintUnbackedStablecoin(
            deployerAddress,
            deployerAddress,
            ethers.utils.parseEther("1000").mul(WeiPerRay)
          )
          await stablecoinAdapter.withdraw(deployerAddress, ethers.utils.parseEther("1000"), "0x")
          await dummyToken.mint(deployerAddress, ethers.utils.parseEther("1000"))

          await dummyToken.approve(pancakeRouter.address, ethers.utils.parseEther("1000"))
          await alpacaStablecoin.approve(pancakeRouter.address, ethers.utils.parseEther("1000"))
          await pancakeRouter.addLiquidity(
            dummyToken.address,
            alpacaStablecoin.address,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1"),
            "0",
            "0",
            deployerAddress,
            FOREVER
          )

          const expectedAmountOut = await pancakeRouter.getAmountOut(
            expectedCollateralBobShouldReceive,
            ethers.utils.parseEther("1000"),
            ethers.utils.parseEther("1000")
          )
          const expectedProfitFromLiquidation = expectedAmountOut.sub(debtShareToRepay)

          await expect(
            liquidationEngineAsBob.liquidate(
              COLLATERAL_POOL_ID,
              alicePositionAddress,
              debtShareToRepay,
              debtShareToRepay,
              pcsFlashLiquidator.address,
              ethers.utils.defaultAbiCoder.encode(
                ["address", "address", "address", "address", "address[]"],
                [
                  bobAddress,
                  ibTokenAdapter.address,
                  AddressZero,
                  pancakeRouter.address,
                  [dummyToken.address, alpacaStablecoin.address],
                ]
              )
            )
          ).to.be.revertedWith("PancakeRouter: INSUFFICIENT_OUTPUT_AMOUNT")
        })
      }
    )
  })
})
