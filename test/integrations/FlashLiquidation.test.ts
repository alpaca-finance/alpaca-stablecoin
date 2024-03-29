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
  StableSwapModule,
  StableSwapModule__factory,
  AuthTokenAdapter__factory,
  AuthTokenAdapter,
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
import { liquidationTestParams } from "./test-params/liquidation"
import { defaultAbiCoder, parseEther, parseUnits } from "ethers/lib/utils"

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
  stableSwapModule: StableSwapModule
  authTokenAdapter: AuthTokenAdapter
  BUSD: BEP20
  ibBUSD: BEP20
  ibBUSDAdapter: IbTokenAdapter
  ibBUSDVault: Vault
}

const ALPACA_PER_BLOCK = ethers.utils.parseEther("100")
const COLLATERAL_POOL_ID = formatBytes32String("dummyToken")
const WBNB_COLLATERAL_POOL_ID = formatBytes32String("ibWBNB")
const IBBUSD_COLLATERAL_POOL_ID = formatBytes32String("ibBUSD")
const BUSD_COLLATERAL_POOL_ID = formatBytes32String("BUSD-StableSwap")
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

  const BUSD = await BEP20.deploy("BUSD", "BUSD")
  await BUSD.deployed()
  await BUSD.mint(await alice.getAddress(), ethers.utils.parseEther("1000000"))

  const ibBUSD = await BEP20.deploy("ibBUSD", "ibBUSD")
  await ibBUSD.deployed()

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

  const ibBUSDVault = await Vault.deploy()
  await ibBUSDVault.deployed()
  await ibBUSDVault.initialize(
    simpleVaultConfig.address,
    BUSD.address,
    "Interest Bearing BUSD",
    "ibBUSD",
    18,
    debtToken.address
  )

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
  await fairLaunch.addPool(1, ibBUSDVault.address, true)
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

  const ibBUSDAdapter = (await upgrades.deployProxy(IbTokenAdapter, [
    bookKeeper.address,
    IBBUSD_COLLATERAL_POOL_ID,
    ibBUSDVault.address,
    alpacaToken.address,
    fairLaunch.address,
    2,
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
  await collateralPoolConfig.initCollateralPool(
    IBBUSD_COLLATERAL_POOL_ID,
    WeiPerRad.mul(10000000),
    0,
    simplePriceFeed.address,
    WeiPerRay,
    WeiPerRay,
    ibBUSDAdapter.address,
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
  await accessControlConfig.grantRole(
    ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]),
    ibBUSDAdapter.address
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
  await collateralPoolConfig.setStrategy(IBBUSD_COLLATERAL_POOL_ID, fixedSpreadLiquidationStrategy.address)
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

  // Setup Pancakeswap
  const PancakeFactoryV2 = new PancakeFactory__factory(deployer)
  const factoryV2 = await PancakeFactoryV2.deploy(await deployer.getAddress())
  await factoryV2.deployed()

  const PancakeRouterV2 = new PancakeRouterV2__factory(deployer)
  const routerV2 = await PancakeRouterV2.deploy(factoryV2.address, wbnb.address)
  await routerV2.deployed()

  /// Setup BUSD-AUSD pair on Pancakeswap
  await factoryV2.createPair(dummyToken.address, BUSD.address)
  await factoryV2.createPair(BUSD.address, alpacaStablecoin.address)
  await factoryV2.createPair(wbnb.address, alpacaStablecoin.address)
  const lpV2 = PancakePair__factory.connect(await factoryV2.getPair(dummyToken.address, BUSD.address), deployer)
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
    BUSD.address,
  ])) as PCSFlashLiquidator

  await pcsFlashLiquidator.whitelist(liquidationEngine.address)
  await pcsFlashLiquidator.whitelist(fixedSpreadLiquidationStrategy.address)
  await pcsFlashLiquidator.whitelist(stablecoinAdapter.address)

  // Deploy AuthTokenAdapter
  const AuthTokenAdapter = (await ethers.getContractFactory("AuthTokenAdapter", deployer)) as AuthTokenAdapter__factory
  const authTokenAdapter = (await upgrades.deployProxy(AuthTokenAdapter, [
    bookKeeper.address,
    BUSD_COLLATERAL_POOL_ID,
    BUSD.address,
  ])) as AuthTokenAdapter
  await authTokenAdapter.deployed()
  await accessControlConfig.grantRole(
    ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]),
    authTokenAdapter.address
  )

  await collateralPoolConfig.initCollateralPool(
    BUSD_COLLATERAL_POOL_ID,
    WeiPerRad.mul(10000000),
    0,
    simplePriceFeed.address,
    WeiPerRay,
    WeiPerRay,
    authTokenAdapter.address,
    CLOSE_FACTOR_BPS,
    LIQUIDATOR_INCENTIVE_BPS,
    TREASURY_FEE_BPS,
    AddressZero
  )
  await collateralPoolConfig.setPriceWithSafetyMargin(BUSD_COLLATERAL_POOL_ID, WeiPerRay)

  // Deploy StableSwapModule
  const StableSwapModule = (await ethers.getContractFactory("StableSwapModule", deployer)) as StableSwapModule__factory
  const stableSwapModule = (await upgrades.deployProxy(StableSwapModule, [
    authTokenAdapter.address,
    stablecoinAdapter.address,
    systemDebtEngine.address,
  ])) as StableSwapModule
  await stableSwapModule.deployed()
  await stableSwapModule.setFeeIn(ethers.utils.parseEther("0.001"))
  await stableSwapModule.setFeeOut(ethers.utils.parseEther("0.001"))
  await authTokenAdapter.grantRole(await authTokenAdapter.WHITELISTED(), stableSwapModule.address)
  await accessControlConfig.grantRole(await accessControlConfig.POSITION_MANAGER_ROLE(), stableSwapModule.address)
  await accessControlConfig.grantRole(await accessControlConfig.COLLATERAL_MANAGER_ROLE(), stableSwapModule.address)

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
    stableSwapModule,
    authTokenAdapter,
    BUSD,
    ibBUSD,
    ibBUSDAdapter,
    ibBUSDVault,
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
  let ibBUSDAdapter: IbTokenAdapter
  let stablecoinAdapter: StablecoinAdapter
  let bookKeeper: BookKeeper
  let dummyToken: BEP20
  let BUSD: BEP20
  let ibBUSD: BEP20
  let shield: Shield
  let alpacaToken: AlpacaToken
  let fairLaunch: FairLaunch
  let bnbVault: Vault
  let ibBUSDVault: Vault

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
  let busdTokenasAlice: BEP20
  let dummyTokenasBob: BEP20

  let liquidationEngineAsBob: LiquidationEngine

  let simplePriceFeedAsDeployer: SimplePriceFeed

  let bookKeeperAsBob: BookKeeper

  let stableSwapModule: StableSwapModule

  let authTokenAdapter: AuthTokenAdapter

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
      stableSwapModule,
      authTokenAdapter,
      BUSD,
      ibBUSD,
      ibBUSDAdapter,
      ibBUSDVault,
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
    busdTokenasAlice = BEP20__factory.connect(BUSD.address, alice)
    dummyTokenasBob = BEP20__factory.connect(dummyToken.address, bob)

    liquidationEngineAsBob = LiquidationEngine__factory.connect(liquidationEngine.address, bob)

    simplePriceFeedAsDeployer = SimplePriceFeed__factory.connect(simplePriceFeed.address, deployer)

    bookKeeperAsBob = BookKeeper__factory.connect(bookKeeper.address, bob)
  })

  describe("#liquidate with MockFlashLiquidator", async () => {
    for (let i = 0; i < liquidationTestParams.length; i++) {
      const testParam = liquidationTestParams[i]
      it(testParam.label, async () => {
        // 1. Set-up test env
        await dummyToken.mint(aliceAddress, parseEther(testParam.collateralAmount))
        await collateralPoolConfig.setLiquidatorIncentiveBps(COLLATERAL_POOL_ID, testParam.liquidatorIncentiveBps)
        await collateralPoolConfig.setCloseFactorBps(COLLATERAL_POOL_ID, testParam.closeFactorBps)
        await simplePriceFeedAsDeployer.setPrice(parseUnits(testParam.startingPrice, 18))
        await collateralPoolConfig.setPriceWithSafetyMargin(
          COLLATERAL_POOL_ID,
          parseUnits(testParam.startingPrice, 18)
            .mul(parseUnits(testParam.collateralFactor, 18))
            .div(parseUnits("1", 9))
        )
        await collateralPoolConfig.setDebtFloor(COLLATERAL_POOL_ID, parseUnits(testParam.debtFloor, 45))

        // 2. Alice open a new position with `testParam.collateralAmount` ibDUMMY and draw `testParam.drawStablecoinAmount` AUSD
        const lockedCollateralAmount = parseEther(testParam.collateralAmount)
        const drawStablecoinAmount = parseEther(testParam.drawStablecoinAmount)
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])

        await dummyTokenasAlice.approve(aliceProxyWallet.address, lockedCollateralAmount)
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
        expect(
          alicePosition.lockedCollateral,
          `lockedCollateral should be ${lockedCollateralAmount} ibDUMMY, because Alice locked ${lockedCollateralAmount} ibDUMMY`
        ).to.be.equal(lockedCollateralAmount)
        expect(
          alicePosition.debtShare,
          `debtShare should be ${drawStablecoinAmount} AUSD, because Alice drew ${drawStablecoinAmount} AUSD`
        ).to.be.equal(drawStablecoinAmount)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(
          alpacaStablecoinBalance,
          `Alice should receive ${drawStablecoinAmount} AUSD from drawing ${drawStablecoinAmount} AUSD`
        ).to.be.equal(drawStablecoinAmount)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. Set price according to the test case
        await simplePriceFeedAsDeployer.setPrice(parseUnits(testParam.nextPrice, 18))
        await collateralPoolConfig.setPriceWithSafetyMargin(
          COLLATERAL_POOL_ID,
          parseUnits(testParam.nextPrice, 18).mul(parseUnits(testParam.collateralFactor, 18)).div(parseUnits("1", 9))
        )

        // 4. Bob liquidate Alice's position with the liquidate test case
        const debtShareToRepay = parseEther(testParam.debtShareToRepay)
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, parseUnits(testParam.debtShareToRepay, 46))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          MaxUint256,
          mockFlashLendingCalleeMintable.address,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes32"], [bobAddress, COLLATERAL_POOL_ID])
        )

        // 5. Settle system bad debt
        await systemDebtEngine.settleSystemBadDebt(await bookKeeper.stablecoin(systemDebtEngine.address))

        const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
        const expectedSeizedCollateral = parseUnits(testParam.expectedSeizedCollateral, 18)
        const expectedLiquidatorIncentive = expectedSeizedCollateral.sub(
          expectedSeizedCollateral.mul(BPS).div(testParam.liquidatorIncentiveBps)
        )
        const expectedTreasuryFee = expectedLiquidatorIncentive.mul(testParam.treasuryFeeBps).div(BPS)
        const expectedCollateralBobShouldReceive = expectedSeizedCollateral.sub(expectedTreasuryFee)

        AssertHelpers.assertAlmostEqual(
          alicePosition.lockedCollateral.sub(alicePositionAfterLiquidation.lockedCollateral).toString(),
          expectedSeizedCollateral.toString()
        )
        expect(alicePositionAfterLiquidation.debtShare).to.be.eq(
          parseUnits(testParam.expectedDebtShareAfterLiquidation, 18)
        )
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.systemBadDebt(systemDebtEngine.address)).toString(),
          parseUnits(testParam.expectedSystemBadDebt, 45).toString()
        )
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress)).toString(),
          expectedCollateralBobShouldReceive.toString()
        )
        AssertHelpers.assertAlmostEqual(
          bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation).toString(),
          parseUnits(testParam.expectedDebtValueToRepay, 45).toString()
        )
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address)).toString(),
          expectedTreasuryFee.toString()
        )
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
        ).to.not.equal(0)
      })
    }
  })

  describe("#liquidate with PCSFlashLiquidator", async () => {
    context(
      `${liquidationTestParams[0].label} with flash liquidation; AUSD is obtained by selling collateral at PCS and stableswap with AUSD`,
      async () => {
        it("should success", async () => {
          // 1. Setup test env
          const testParam = liquidationTestParams[0]
          await dummyToken.mint(aliceAddress, parseEther(testParam.collateralAmount))
          await collateralPoolConfig.setLiquidatorIncentiveBps(COLLATERAL_POOL_ID, testParam.liquidatorIncentiveBps)
          await collateralPoolConfig.setCloseFactorBps(COLLATERAL_POOL_ID, testParam.closeFactorBps)
          await simplePriceFeedAsDeployer.setPrice(parseUnits(testParam.startingPrice, 18))
          await collateralPoolConfig.setPriceWithSafetyMargin(
            COLLATERAL_POOL_ID,
            parseUnits(testParam.startingPrice, 18)
              .mul(parseUnits(testParam.collateralFactor, 18))
              .div(parseUnits("1", 9))
          )
          await collateralPoolConfig.setDebtFloor(COLLATERAL_POOL_ID, parseUnits(testParam.debtFloor, 45))

          // 2. Alice open a new position with `testParam.collateralAmount` ibDUMMY and draw `testParam.drawStablecoinAmount` AUSD
          const lockedCollateralAmount = parseEther(testParam.collateralAmount)
          const drawStablecoinAmount = parseEther(testParam.drawStablecoinAmount)
          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            COLLATERAL_POOL_ID,
            lockedCollateralAmount,
            drawStablecoinAmount,
            true,
            defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])

          await dummyTokenasAlice.approve(aliceProxyWallet.address, lockedCollateralAmount)
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
          const alicePositionAddress = await positionManager.positions(1)
          const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
          const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          expect(
            alicePosition.lockedCollateral,
            `lockedCollateral should be ${lockedCollateralAmount} ibDUMMY, because Alice locked ${lockedCollateralAmount} ibDUMMY`
          ).to.be.equal(lockedCollateralAmount)
          expect(
            alicePosition.debtShare,
            `debtShare should be ${drawStablecoinAmount} AUSD, because Alice drew ${drawStablecoinAmount} AUSD`
          ).to.be.equal(drawStablecoinAmount)
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(
            alpacaStablecoinBalance,
            `Alice should receive ${drawStablecoinAmount} AUSD from drawing ${drawStablecoinAmount} AUSD`
          ).to.be.equal(drawStablecoinAmount)
          expect(
            await alpacaToken.balanceOf(aliceProxyWallet.address),
            "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
          ).to.be.equal(0)

          // 3. Set price according to the test case
          await simplePriceFeedAsDeployer.setPrice(parseUnits(testParam.nextPrice, 18))
          await collateralPoolConfig.setPriceWithSafetyMargin(
            COLLATERAL_POOL_ID,
            parseUnits(testParam.nextPrice, 18).mul(parseUnits(testParam.collateralFactor, 18)).div(parseUnits("1", 9))
          )

          // 4. Bob liquidate Alice's position up to full close factor successfully
          const debtShareToRepay = parseEther(testParam.debtShareToRepay)
          await bookKeeperAsBob.whitelist(liquidationEngine.address)
          await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
          await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
          const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
          const expectedSeizedCollateral = parseUnits(testParam.expectedSeizedCollateral, 18)
          const expectedLiquidatorIncentive = expectedSeizedCollateral.sub(
            expectedSeizedCollateral.mul(BPS).div(testParam.liquidatorIncentiveBps)
          )
          const expectedTreasuryFee = expectedLiquidatorIncentive.mul(testParam.treasuryFeeBps).div(BPS)
          const expectedCollateralBobShouldReceive = expectedSeizedCollateral.sub(expectedTreasuryFee)

          const dummyPcsLiquidity = parseEther("1000000")
          const busdPcsLiquidity = parseEther("285000000")
          await dummyToken.mint(deployerAddress, dummyPcsLiquidity)
          await BUSD.mint(deployerAddress, busdPcsLiquidity)

          await dummyToken.approve(pancakeRouter.address, dummyPcsLiquidity)
          await BUSD.approve(pancakeRouter.address, busdPcsLiquidity)

          await pancakeRouter.addLiquidity(
            dummyToken.address,
            BUSD.address,
            dummyPcsLiquidity,
            busdPcsLiquidity,
            "0",
            "0",
            deployerAddress,
            FOREVER
          )

          const expectedAmountOut = await pancakeRouter.getAmountOut(
            expectedCollateralBobShouldReceive,
            dummyPcsLiquidity,
            busdPcsLiquidity
          )

          await liquidationEngineAsBob.liquidate(
            COLLATERAL_POOL_ID,
            alicePositionAddress,
            debtShareToRepay,
            debtShareToRepay,
            pcsFlashLiquidator.address,
            ethers.utils.defaultAbiCoder.encode(
              ["address", "address", "address", "address", "address[]", "address"],
              [
                bobAddress,
                ibTokenAdapter.address,
                AddressZero,
                pancakeRouter.address,
                [dummyToken.address, BUSD.address],
                stableSwapModule.address,
              ]
            )
          )

          // feeFromSwap = fee + debtShareToRepay
          const feeFromSwap = (await bookKeeper.stablecoin(systemDebtEngine.address)).div(WeiPerRay)
          const expectedProfitFromLiquidation = expectedAmountOut.sub(feeFromSwap.add(1))

          // 5. Settle system bad debt
          await systemDebtEngine.settleSystemBadDebt(debtShareToRepay.mul(WeiPerRay))

          const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)
          const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          AssertHelpers.assertAlmostEqual(
            alicePosition.lockedCollateral.sub(alicePositionAfterLiquidation.lockedCollateral).toString(),
            expectedSeizedCollateral.toString()
          )
          expect(
            alicePositionAfterLiquidation.debtShare,
            `debtShare should be ${testParam.expectedDebtShareAfterLiquidation} AUSD`
          ).to.be.equal(parseUnits(testParam.expectedDebtShareAfterLiquidation, 18))
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
          AssertHelpers.assertAlmostEqual(
            (await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address)).toString(),
            expectedTreasuryFee.toString()
          )
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
          AssertHelpers.assertAlmostEqual(
            alpacaStablecoinBalanceAfter.sub(alpacaStablecoinBalanceBefore),
            expectedProfitFromLiquidation
          )
        })
      }
    )

    context(
      `${liquidationTestParams[0].label} with flash liquidation; AUSD is obtained by selling collateral at PCS and stableswap with AUSD`,
      async () => {
        it("should revert", async () => {
          // 1. Setup test env
          const testParam = liquidationTestParams[0]
          await dummyToken.mint(aliceAddress, parseEther(testParam.collateralAmount))
          await collateralPoolConfig.setLiquidatorIncentiveBps(COLLATERAL_POOL_ID, testParam.liquidatorIncentiveBps)
          await collateralPoolConfig.setCloseFactorBps(COLLATERAL_POOL_ID, testParam.closeFactorBps)
          await simplePriceFeedAsDeployer.setPrice(parseUnits(testParam.startingPrice, 18))
          await collateralPoolConfig.setPriceWithSafetyMargin(
            COLLATERAL_POOL_ID,
            parseUnits(testParam.startingPrice, 18)
              .mul(parseUnits(testParam.collateralFactor, 18))
              .div(parseUnits("1", 9))
          )
          await collateralPoolConfig.setDebtFloor(COLLATERAL_POOL_ID, parseUnits(testParam.debtFloor, 45))

          // 2. Alice open a new position with `testParam.collateralAmount` ibDUMMY and draw `testParam.drawStablecoinAmount` AUSD
          const lockedCollateralAmount = parseEther(testParam.collateralAmount)
          const drawStablecoinAmount = parseEther(testParam.drawStablecoinAmount)
          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            COLLATERAL_POOL_ID,
            lockedCollateralAmount,
            drawStablecoinAmount,
            true,
            defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])

          await dummyTokenasAlice.approve(aliceProxyWallet.address, lockedCollateralAmount)
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
          const alicePositionAddress = await positionManager.positions(1)
          const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
          const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          expect(
            alicePosition.lockedCollateral,
            `lockedCollateral should be ${lockedCollateralAmount} ibDUMMY, because Alice locked ${lockedCollateralAmount} ibDUMMY`
          ).to.be.equal(lockedCollateralAmount)
          expect(
            alicePosition.debtShare,
            `debtShare should be ${drawStablecoinAmount} AUSD, because Alice drew ${drawStablecoinAmount} AUSD`
          ).to.be.equal(drawStablecoinAmount)
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(
            alpacaStablecoinBalance,
            `Alice should receive ${drawStablecoinAmount} AUSD from drawing ${drawStablecoinAmount} AUSD`
          ).to.be.equal(drawStablecoinAmount)
          expect(
            await alpacaToken.balanceOf(aliceProxyWallet.address),
            "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
          ).to.be.equal(0)

          // 3. Set price according to the test case
          await simplePriceFeedAsDeployer.setPrice(parseUnits(testParam.nextPrice, 18))
          await collateralPoolConfig.setPriceWithSafetyMargin(
            COLLATERAL_POOL_ID,
            parseUnits(testParam.nextPrice, 18).mul(parseUnits(testParam.collateralFactor, 18)).div(parseUnits("1", 9))
          )

          // 4. Bob liquidate Alice's position up to full close factor successfully
          const debtShareToRepay = parseEther(testParam.debtShareToRepay)
          await bookKeeperAsBob.whitelist(liquidationEngine.address)
          await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
          await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))

          const dummyPcsLiquidity = parseEther("1")
          const busdPcsLiquidity = parseEther("1")
          await dummyToken.mint(deployerAddress, dummyPcsLiquidity)
          await BUSD.mint(deployerAddress, busdPcsLiquidity)

          await dummyToken.approve(pancakeRouter.address, dummyPcsLiquidity)
          await BUSD.approve(pancakeRouter.address, busdPcsLiquidity)

          await pancakeRouter.addLiquidity(
            dummyToken.address,
            BUSD.address,
            dummyPcsLiquidity,
            busdPcsLiquidity,
            "0",
            "0",
            deployerAddress,
            FOREVER
          )

          await expect(
            liquidationEngineAsBob.liquidate(
              COLLATERAL_POOL_ID,
              alicePositionAddress,
              debtShareToRepay,
              debtShareToRepay,
              pcsFlashLiquidator.address,
              ethers.utils.defaultAbiCoder.encode(
                ["address", "address", "address", "address", "address[]", "address"],
                [
                  bobAddress,
                  ibTokenAdapter.address,
                  AddressZero,
                  pancakeRouter.address,
                  [dummyToken.address, BUSD.address],
                  stableSwapModule.address,
                ]
              )
            )
          ).to.be.revertedWith("PancakeRouter: INSUFFICIENT_OUTPUT_AMOUNT")
        })
      }
    )
  })
})
