import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import * as TimeHelpers from "../../../../helper/time"
import { MaxUint256 } from "@ethersproject/constants"

import {
  ProxyWalletRegistry__factory,
  ProxyWalletFactory__factory,
  ProxyWalletRegistry,
  BookKeeper__factory,
  PositionManager,
  PositionManager__factory,
  BookKeeper,
  AlpacaStablecoinProxyActions__factory,
  AlpacaStablecoinProxyActions,
  StablecoinAdapter__factory,
  StablecoinAdapter,
  AlpacaStablecoin__factory,
  AlpacaStablecoin,
  ProxyWallet,
  SystemDebtEngine__factory,
  SystemDebtEngine,
  CollateralPoolConfig__factory,
  CollateralPoolConfig,
  SimplePriceFeed__factory,
  SimplePriceFeed,
  AccessControlConfig__factory,
  AccessControlConfig,
  ShowStopper,
  ShowStopper__factory,
  LPTokenAutoCompoundAdapter__factory,
  LPTokenAutoCompoundAdapter,
  BEP20__factory,
  BEP20,
} from "../../../../../typechain"
import {
  PancakeFactory__factory,
  PancakeFactory,
  PancakePair__factory,
  PancakePair,
  PancakeRouterV2__factory,
  PancakeRouterV2,
  WETH__factory,
  WETH,
  PancakeMasterChef__factory,
  CakeToken__factory,
  SyrupBar__factory,
  PancakeswapV2RestrictedStrategyAddBaseTokenOnly,
  PancakeswapV2RestrictedStrategyAddBaseTokenOnly__factory,
} from "@alpaca-finance/alpaca-contract/typechain"
import { expect } from "chai"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../../../helper/unit"
import { loadProxyWalletFixtureHandler } from "../../../../helper/proxy"

import * as AssertHelpers from "../../../../helper/assert"
import { AddressZero } from "../../../../helper/address"

const { formatBytes32String } = ethers.utils

type fixture = {
  proxyWalletRegistry: ProxyWalletRegistry
  stablecoinAdapter: StablecoinAdapter
  bookKeeper: BookKeeper
  alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  positionManager: PositionManager
  alpacaStablecoin: AlpacaStablecoin
  simplePriceFeed: SimplePriceFeed
  systemDebtEngine: SystemDebtEngine
  collateralPoolConfig: CollateralPoolConfig
}

const COLLATERAL_POOL_ID = formatBytes32String("BUSD-AUSD PCS")
const CLOSE_FACTOR_BPS = BigNumber.from(5000)
const LIQUIDATOR_INCENTIVE_BPS = BigNumber.from(10250)
const TREASURY_FEE_BPS = BigNumber.from(5000)
const BPS = BigNumber.from(10000)
const CAKE_REWARD_PER_BLOCK = ethers.utils.parseEther("0.1")

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

  const SimplePriceFeed = (await ethers.getContractFactory("SimplePriceFeed", deployer)) as SimplePriceFeed__factory
  const simplePriceFeed = (await upgrades.deployProxy(SimplePriceFeed, [
    accessControlConfig.address,
  ])) as SimplePriceFeed
  await simplePriceFeed.deployed()

  // Setup Pancakeswap
  const PancakeFactoryV2 = new PancakeFactory__factory(deployer)
  const factoryV2 = await PancakeFactoryV2.deploy(await deployer.getAddress())
  await factoryV2.deployed()

  const WBNB = new WETH__factory(deployer)
  const wbnb = await WBNB.deploy()
  await wbnb.deployed()

  const PancakeRouterV2 = new PancakeRouterV2__factory(deployer)
  const router = await PancakeRouterV2.deploy(factoryV2.address, wbnb.address)
  await router.deployed()

  // Deploy Alpaca Stablecoin
  const AlpacaStablecoin = (await ethers.getContractFactory("AlpacaStablecoin", deployer)) as AlpacaStablecoin__factory
  const alpacaStablecoin = (await upgrades.deployProxy(AlpacaStablecoin, [
    "Alpaca USD",
    "AUSD",
    "31337",
  ])) as AlpacaStablecoin
  await alpacaStablecoin.deployed()

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const BUSD = await BEP20.deploy("BUSD", "BUSD")
  await BUSD.deployed()

  /// Setup BUSD-AUSD pair on Pancakeswap
  await factoryV2.createPair(BUSD.address, alpacaStablecoin.address)
  const lpToken = PancakePair__factory.connect(
    await factoryV2.getPair(BUSD.address, alpacaStablecoin.address),
    deployer
  )
  await lpToken.deployed()

  const CakeToken = (await ethers.getContractFactory("CakeToken", deployer)) as CakeToken__factory
  const cake = await CakeToken.deploy()
  const SyrupBar = (await ethers.getContractFactory("SyrupBar", deployer)) as SyrupBar__factory
  const syrup = await SyrupBar.deploy(cake.address)

  /// Setup MasterChef
  const PancakeMasterChef = (await ethers.getContractFactory(
    "PancakeMasterChef",
    deployer
  )) as PancakeMasterChef__factory
  const masterChef = await PancakeMasterChef.deploy(
    cake.address,
    syrup.address,
    await deployer.getAddress(),
    CAKE_REWARD_PER_BLOCK,
    0
  )

  const PancakeswapV2RestrictedStrategyAddBaseTokenOnly = (await ethers.getContractFactory(
    "PancakeswapV2RestrictedStrategyAddBaseTokenOnly",
    deployer
  )) as PancakeswapV2RestrictedStrategyAddBaseTokenOnly__factory
  const addStrat = (await upgrades.deployProxy(PancakeswapV2RestrictedStrategyAddBaseTokenOnly, [
    router.address,
  ])) as PancakeswapV2RestrictedStrategyAddBaseTokenOnly
  await addStrat.deployed()

  const LPTokenAutoCompoundAdapter = (await ethers.getContractFactory(
    "LPTokenAutoCompoundAdapter",
    deployer
  )) as LPTokenAutoCompoundAdapter__factory
  const lpTokenAutoCompoundAdapter = (await upgrades.deployProxy(LPTokenAutoCompoundAdapter, [
    bookKeeper.address,
    COLLATERAL_POOL_ID,
    lpToken.address,
    cake.address,
    masterChef.address,
    0,
    TREASURY_FEE_BPS,
    deployer.address,
    positionManager.address,
    router.address,
    alpacaStablecoin.address,
    addStrat.address,
  ])) as LPTokenAutoCompoundAdapter
  await lpTokenAutoCompoundAdapter.deployed()
  await addStrat.setWorkersOk([lpTokenAutoCompoundAdapter.address], true)

  await collateralPoolConfig.initCollateralPool(
    COLLATERAL_POOL_ID,
    0,
    0,
    simplePriceFeed.address,
    WeiPerRay,
    WeiPerRay,
    lpTokenAutoCompoundAdapter.address,
    CLOSE_FACTOR_BPS,
    LIQUIDATOR_INCENTIVE_BPS,
    TREASURY_FEE_BPS,
    AddressZero
  )
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10000000))
  await collateralPoolConfig.setDebtCeiling(COLLATERAL_POOL_ID, WeiPerRad.mul(10000000))
  await accessControlConfig.grantRole(await accessControlConfig.PRICE_ORACLE_ROLE(), deployer.address)
  await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

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

  return {
    proxyWalletRegistry,
    stablecoinAdapter,
    bookKeeper,
    alpacaStablecoinProxyActions,
    positionManager,
    alpacaStablecoin,
    simplePriceFeed,
    systemDebtEngine,
    collateralPoolConfig,
  }
}

describe("LPTokenAutoCompoundAdapter", () => {
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

  let stablecoinAdapter: StablecoinAdapter
  let bookKeeper: BookKeeper

  let positionManager: PositionManager

  let alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions

  let alpacaStablecoin: AlpacaStablecoin

  let simplePriceFeed: SimplePriceFeed

  let systemDebtEngine: SystemDebtEngine

  let collateralPoolConfig: CollateralPoolConfig

  // Signer

  before(async () => {
    ;({
      proxyWallets: [deployerProxyWallet, aliceProxyWallet],
    } = await waffle.loadFixture(loadProxyWalletFixtureHandler))
  })

  beforeEach(async () => {
    ;({
      proxyWalletRegistry,
      stablecoinAdapter,
      bookKeeper,
      alpacaStablecoinProxyActions,
      positionManager,
      alpacaStablecoin,
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
  })
})
