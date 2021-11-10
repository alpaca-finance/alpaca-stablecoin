import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import * as TimeHelpers from "../../helper/time"
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
  CollateralPoolConfig__factory,
  CollateralPoolConfig,
  SimplePriceFeed__factory,
  SimplePriceFeed,
  AccessControlConfig__factory,
  AccessControlConfig,
  ShowStopper,
  ShowStopper__factory,
} from "../../../typechain"
import {
  DebtToken__factory,
  MockWBNB,
  MockWBNB__factory,
  SimpleVaultConfig__factory,
  Vault,
  Vault__factory,
  WNativeRelayer,
  WNativeRelayer__factory,
} from "@alpaca-finance/alpaca-contract/typechain"
import {
  PancakeFactory__factory,
  PancakeFactory,
  PancakePair__factory,
  PancakePair,
  PancakeRouterV2__factory,
  PancakeRouterV2,
  WETH__factory,
  WETH,
} from "@alpaca-finance/alpaca-contract/typechain"
import { expect } from "chai"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"
import { loadProxyWalletFixtureHandler } from "../../helper/proxy"

import * as AssertHelpers from "../../helper/assert"
import { AddressZero } from "../../helper/address"

const { formatBytes32String } = ethers.utils

type fixture = {
  proxyWalletRegistry: ProxyWalletRegistry
  ibTokenAdapter: IbTokenAdapter
  stablecoinAdapter: StablecoinAdapter
  bookKeeper: BookKeeper
  busdVault: Vault
  shield: Shield
  alpacaToken: AlpacaToken
  fairLaunch: FairLaunch
  alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  positionManager: PositionManager
  stabilityFeeCollector: StabilityFeeCollector
  alpacaStablecoin: AlpacaStablecoin
  liquidationEngine: LiquidationEngine
  fixedSpreadLiquidationStrategy: FixedSpreadLiquidationStrategy
  simplePriceFeed: SimplePriceFeed
  systemDebtEngine: SystemDebtEngine
  collateralPoolConfig: CollateralPoolConfig
}

const ALPACA_PER_BLOCK = ethers.utils.parseEther("100")
const COLLATERAL_POOL_ID = formatBytes32String("ibDUMMY")
const CLOSE_FACTOR_BPS = BigNumber.from(5000)
const LIQUIDATOR_INCENTIVE_BPS = BigNumber.from(10250)
const TREASURY_FEE_BPS = BigNumber.from(5000)
const BPS = BigNumber.from(10000)

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer, alice, bob, dev] = await ethers.getSigners()

  // alpaca vault
  const ALPACA_BONUS_LOCK_UP_BPS = 7000
  const ALPACA_REWARD_PER_BLOCK = ethers.utils.parseEther("5000")
  const RESERVE_POOL_BPS = "1000" // 10% reserve pool
  const KILL_PRIZE_BPS = "1000" // 10% Kill prize
  const INTEREST_RATE = "3472222222222" // 30% per year
  const MIN_DEBT_SIZE = ethers.utils.parseEther("1") // 1 BTOKEN min debt size
  const KILL_TREASURY_BPS = "100"

  const WBNB = new MockWBNB__factory(deployer)
  const wbnb = (await WBNB.deploy()) as MockWBNB
  await wbnb.deployed()

  const WNativeRelayer = new WNativeRelayer__factory(deployer)
  const wNativeRelayer = (await WNativeRelayer.deploy(wbnb.address)) as WNativeRelayer
  await wNativeRelayer.deployed()

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const baseToken = await BEP20.deploy("BTOKEN", "BTOKEN")
  await baseToken.deployed()
  await baseToken.mint(await deployer.getAddress(), ethers.utils.parseEther("100"))
  await baseToken.mint(await alice.getAddress(), ethers.utils.parseEther("100"))

  const DebtToken = new DebtToken__factory(deployer)
  const debtToken = await DebtToken.deploy()
  await debtToken.deployed()
  await debtToken.initialize("debtibBTOKEN_V2", "debtibBTOKEN_V2", deployer.address)

  // Deploy Alpaca's Fairlaunch
  const AlpacaToken = (await ethers.getContractFactory("AlpacaToken", deployer)) as AlpacaToken__factory
  const alpacaToken = await AlpacaToken.deploy(88, 89)
  await alpacaToken.mint(await deployer.getAddress(), ethers.utils.parseEther("150"))
  await alpacaToken.deployed()

  const FairLaunch = (await ethers.getContractFactory("FairLaunch", deployer)) as FairLaunch__factory
  const fairLaunch = await FairLaunch.deploy(alpacaToken.address, await dev.getAddress(), ALPACA_PER_BLOCK, 0, 0, 0)
  await fairLaunch.deployed()

  const Shield = (await ethers.getContractFactory("Shield", deployer)) as Shield__factory
  const shield = await Shield.deploy(deployer.address, fairLaunch.address)
  await shield.deployed()

  // Config Alpaca's FairLaunch
  // Assuming Deployer is timelock for easy testing
  await fairLaunch.transferOwnership(shield.address)
  await shield.transferOwnership(await deployer.getAddress())
  await alpacaToken.transferOwnership(fairLaunch.address)

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
  const busdVault = await Vault.deploy()
  await busdVault.deployed()
  await busdVault.initialize(
    simpleVaultConfig.address,
    baseToken.address,
    "Interest Bearing BTOKEN",
    "ibBTOKEN",
    18,
    debtToken.address
  )

  await fairLaunch.addPool(1, busdVault.address, true)

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

  // Deploy ShowStopper
  const ShowStopper = (await ethers.getContractFactory("ShowStopper", deployer)) as ShowStopper__factory
  const showStopper = (await upgrades.deployProxy(ShowStopper, [bookKeeper.address])) as ShowStopper

  // Deploy PositionManager
  const PositionManager = (await ethers.getContractFactory("PositionManager", deployer)) as PositionManager__factory
  const positionManager = (await upgrades.deployProxy(PositionManager, [
    bookKeeper.address,
    showStopper.address,
  ])) as PositionManager
  await positionManager.deployed()
  await accessControlConfig.grantRole(await accessControlConfig.POSITION_MANAGER_ROLE(), positionManager.address)

  const IbTokenAdapter = (await ethers.getContractFactory("IbTokenAdapter", deployer)) as IbTokenAdapter__factory
  const ibTokenAdapter = (await upgrades.deployProxy(IbTokenAdapter, [
    bookKeeper.address,
    COLLATERAL_POOL_ID,
    busdVault.address,
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

  await accessControlConfig.grantRole(
    ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]),
    ibTokenAdapter.address
  )
  await accessControlConfig.grantRole(await accessControlConfig.MINTABLE_ROLE(), deployer.address)

  const SimplePriceFeed = (await ethers.getContractFactory("SimplePriceFeed", deployer)) as SimplePriceFeed__factory
  const simplePriceFeed = (await upgrades.deployProxy(SimplePriceFeed, [
    accessControlConfig.address,
  ])) as SimplePriceFeed
  await simplePriceFeed.deployed()

  await collateralPoolConfig.initCollateralPool(
    COLLATERAL_POOL_ID,
    0,
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
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10000000))
  await collateralPoolConfig.setDebtCeiling(COLLATERAL_POOL_ID, WeiPerRad.mul(10000000))
  await accessControlConfig.grantRole(await accessControlConfig.PRICE_ORACLE_ROLE(), deployer.address)
  await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

  // Deploy Alpaca Stablecoin
  const AlpacaStablecoin = (await ethers.getContractFactory("AlpacaStablecoin", deployer)) as AlpacaStablecoin__factory
  const alpacaStablecoin = (await upgrades.deployProxy(AlpacaStablecoin, [
    "Alpaca USD",
    "AUSD",
    "31337",
  ])) as AlpacaStablecoin
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
  await accessControlConfig.grantRole(await accessControlConfig.LIQUIDATION_ENGINE_ROLE(), liquidationEngine.address)
  await accessControlConfig.grantRole(
    await accessControlConfig.LIQUIDATION_ENGINE_ROLE(),
    fixedSpreadLiquidationStrategy.address
  )

  return {
    proxyWalletRegistry,
    ibTokenAdapter,
    stablecoinAdapter,
    bookKeeper,
    busdVault,
    shield,
    alpacaToken,
    fairLaunch,
    alpacaStablecoinProxyActions,
    positionManager,
    stabilityFeeCollector,
    alpacaStablecoin,
    liquidationEngine,
    fixedSpreadLiquidationStrategy,
    simplePriceFeed,
    systemDebtEngine,
    collateralPoolConfig,
  }
}

describe("PCSFlashLiquidator", () => {
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

  let ibTokenAdapter: IbTokenAdapter
  let stablecoinAdapter: StablecoinAdapter
  let bookKeeper: BookKeeper
  let ibDUMMY: BEP20
  let shield: Shield
  let alpacaToken: AlpacaToken
  let fairLaunch: FairLaunch

  let positionManager: PositionManager

  let stabilityFeeCollector: StabilityFeeCollector

  let liquidationEngine: LiquidationEngine
  let fixedSpreadLiquidationStrategy: FixedSpreadLiquidationStrategy

  let alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions

  let alpacaStablecoin: AlpacaStablecoin

  let simplePriceFeed: SimplePriceFeed

  let systemDebtEngine: SystemDebtEngine

  let collateralPoolConfig: CollateralPoolConfig

  let busdVault: Vault

  // Signer
  let ibTokenAdapterAsAlice: IbTokenAdapter
  let ibTokenAdapterAsBob: IbTokenAdapter

  let ibDUMMYasAlice: BEP20
  let ibDUMMYasBob: BEP20

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
      proxyWalletRegistry,
      ibTokenAdapter,
      stablecoinAdapter,
      bookKeeper,
      busdVault,
      shield,
      alpacaToken,
      fairLaunch,
      alpacaStablecoinProxyActions,
      positionManager,
      stabilityFeeCollector,
      alpacaStablecoin,
      liquidationEngine,
      fixedSpreadLiquidationStrategy,
      simplePriceFeed,
      systemDebtEngine,
      collateralPoolConfig,
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

    ibDUMMYasAlice = BEP20__factory.connect(ibDUMMY.address, alice)
    ibDUMMYasBob = BEP20__factory.connect(ibDUMMY.address, bob)

    liquidationEngineAsBob = LiquidationEngine__factory.connect(liquidationEngine.address, bob)

    simplePriceFeedAsDeployer = SimplePriceFeed__factory.connect(simplePriceFeed.address, deployer)

    bookKeeperAsBob = BookKeeper__factory.connect(bookKeeper.address, bob)
  })
  describe("#liquidate", async () => {})
})
