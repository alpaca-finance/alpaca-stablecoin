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
import { expect } from "chai"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"
import { loadProxyWalletFixtureHandler } from "../../helper/proxy"

import * as AssertHelpers from "../../helper/assert"
import { AddressZero } from "../../helper/address"

import { parseEther, parseUnits, defaultAbiCoder, solidityKeccak256 } from "ethers/lib/utils"

const { formatBytes32String } = ethers.utils

type fixture = {
  proxyWalletRegistry: ProxyWalletRegistry
  ibTokenAdapter: IbTokenAdapter
  stablecoinAdapter: StablecoinAdapter
  bookKeeper: BookKeeper
  ibDUMMY: BEP20
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

const ALPACA_PER_BLOCK = parseEther("100")
const COLLATERAL_POOL_ID = formatBytes32String("ibDUMMY")
const CLOSE_FACTOR_BPS = BigNumber.from(5000)
const LIQUIDATOR_INCENTIVE_BPS = BigNumber.from(10500)
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
  await accessControlConfig.grantRole(await accessControlConfig.BOOK_KEEPER_ROLE(), deployer.address)

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const ibDUMMY = await BEP20.deploy("ibDUMMY", "ibDUMMY")
  await ibDUMMY.deployed()
  await ibDUMMY.mint(await alice.getAddress(), parseEther("1000000"))
  await ibDUMMY.mint(await bob.getAddress(), parseEther("100"))

  // Deploy Alpaca's Fairlaunch
  const AlpacaToken = (await ethers.getContractFactory("AlpacaToken", deployer)) as AlpacaToken__factory
  const alpacaToken = await AlpacaToken.deploy(88, 89)
  await alpacaToken.mint(await deployer.getAddress(), parseEther("150"))
  await alpacaToken.deployed()

  const FairLaunch = (await ethers.getContractFactory("FairLaunch", deployer)) as FairLaunch__factory
  const fairLaunch = await FairLaunch.deploy(alpacaToken.address, await dev.getAddress(), ALPACA_PER_BLOCK, 0, 0, 0)
  await fairLaunch.deployed()

  const Shield = (await ethers.getContractFactory("Shield", deployer)) as Shield__factory
  const shield = await Shield.deploy(deployer.address, fairLaunch.address)
  await shield.deployed()

  // Config Alpaca's FairLaunch
  // Assuming Deployer is timelock for easy testing
  await fairLaunch.addPool(1, ibDUMMY.address, true)
  await fairLaunch.transferOwnership(shield.address)
  await shield.transferOwnership(await deployer.getAddress())
  await alpacaToken.transferOwnership(fairLaunch.address)

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
  await accessControlConfig.grantRole(await accessControlConfig.COLLATERAL_MANAGER_ROLE(), positionManager.address)

  const IbTokenAdapter = (await ethers.getContractFactory("IbTokenAdapter", deployer)) as IbTokenAdapter__factory
  const ibTokenAdapter = (await upgrades.deployProxy(IbTokenAdapter, [
    bookKeeper.address,
    COLLATERAL_POOL_ID,
    ibDUMMY.address,
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

  await accessControlConfig.grantRole(solidityKeccak256(["string"], ["ADAPTER_ROLE"]), ibTokenAdapter.address)
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

  await alpacaStablecoin.grantRole(await alpacaStablecoin.MINTER_ROLE(), stablecoinAdapter.address)

  const AlpacaStablecoinProxyActions = new AlpacaStablecoinProxyActions__factory(deployer)
  const alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions = await AlpacaStablecoinProxyActions.deploy()

  const SystemDebtEngine = (await ethers.getContractFactory("SystemDebtEngine", deployer)) as SystemDebtEngine__factory
  const systemDebtEngine = (await upgrades.deployProxy(SystemDebtEngine, [bookKeeper.address])) as SystemDebtEngine
  await accessControlConfig.grantRole(await accessControlConfig.COLLATERAL_MANAGER_ROLE(), systemDebtEngine.address)

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
  await accessControlConfig.grantRole(await accessControlConfig.LIQUIDATION_ENGINE_ROLE(), liquidationEngine.address)
  await accessControlConfig.grantRole(
    await accessControlConfig.LIQUIDATION_ENGINE_ROLE(),
    fixedSpreadLiquidationStrategy.address
  )
  await accessControlConfig.grantRole(
    await accessControlConfig.COLLATERAL_MANAGER_ROLE(),
    fixedSpreadLiquidationStrategy.address
  )

  return {
    proxyWalletRegistry,
    ibTokenAdapter,
    stablecoinAdapter,
    bookKeeper,
    ibDUMMY,
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

describe("LiquidationEngine", () => {
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
      ibDUMMY,
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
  describe("#liquidate", async () => {
    context("price drop but does not make the position underwater", async () => {
      it("should revert", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          WeiPerWad,
          WeiPerWad,
          true,
          defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)

        // 3. ibDUMMY price drop to 1 USD
        await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

        // 4. Bob try to liquidate Alice's position but failed due to the price did not drop low enough
        await expect(
          liquidationEngineAsBob.liquidate(COLLATERAL_POOL_ID, alicePositionAddress, 1, 1, aliceAddress, "0x")
        ).to.be.revertedWith("LiquidationEngine/position-is-safe")
      })
    })

    context("safety buffer -0.1%, but liquidator does not have enough AUSD to liquidate", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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
          defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. ibDUMMY price drop to 0.99 USD
        await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.sub(1))
        await simplePriceFeedAsDeployer.setPrice(WeiPerRay.sub(1).div(1e9))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = parseEther("0.5")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)

        await expect(
          liquidationEngineAsBob.liquidate(
            COLLATERAL_POOL_ID,
            alicePositionAddress,
            debtShareToRepay,
            MaxUint256,
            bobAddress,
            defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
          )
        ).to.be.reverted
      })
    })

    context("main liquidation scenarios", async () => {
      const testParams = [
        {
          label: "safety buffer -0.18%, position is liquidated up to full close factor",
          collateralAmount: "10",
          collateralFactor: "0.7",
          liquidatorIncentiveBps: "10500",
          treasuryFeeBps: "5000",
          closeFactorBps: "5000",
          debtFloor: "100",
          drawStablecoinAmount: "2000",
          startingPrice: "420",
          nextPrice: "285",
          debtShareToRepay: "1000",
          expectedDebtValueToRepay: "1000",
          expectedSeizedCollateral: "3.684210526315790000",
          expectedDebtShareAfterLiquidation: "1000",
          expectedSystemBadDebt: "0",
        },
        {
          label: "safety buffer -0.18%, position is liquidated up to some portion of close factor",
          collateralAmount: "10",
          collateralFactor: "0.7",
          liquidatorIncentiveBps: "10500",
          treasuryFeeBps: "5000",
          closeFactorBps: "5000",
          debtFloor: "100",
          drawStablecoinAmount: "2000",
          startingPrice: "420",
          nextPrice: "285",
          debtShareToRepay: "200",
          expectedDebtValueToRepay: "200",
          expectedSeizedCollateral: "0.7368",
          expectedDebtShareAfterLiquidation: "1800",
          expectedSystemBadDebt: "0",
        },
        {
          label: "safety buffer -0.18%, position is liquidated exceeding close factor",
          collateralAmount: "10",
          collateralFactor: "0.7",
          liquidatorIncentiveBps: "10500",
          treasuryFeeBps: "5000",
          closeFactorBps: "5000",
          debtFloor: "100",
          drawStablecoinAmount: "2000",
          startingPrice: "420",
          nextPrice: "285",
          debtShareToRepay: "2000",
          expectedDebtValueToRepay: "1000",
          expectedSeizedCollateral: "3.684210526315790000",
          expectedDebtShareAfterLiquidation: "1000",
          expectedSystemBadDebt: "0",
        },
        {
          label: "safety buffer -30%, position is liquidated up to full close factor, bad debt",
          collateralAmount: "10",
          collateralFactor: "0.7",
          liquidatorIncentiveBps: "10500",
          treasuryFeeBps: "5000",
          closeFactorBps: "5000",
          debtFloor: "100",
          drawStablecoinAmount: "2000",
          startingPrice: "420",
          nextPrice: "200",
          debtShareToRepay: "1000",
          expectedDebtValueToRepay: "1904.761905",
          expectedSeizedCollateral: "10",
          expectedDebtShareAfterLiquidation: "0",
          expectedSystemBadDebt: "95.238095",
        },
        {
          label: "safety buffer -30%, position is liquidated up to some portion of full close factor, bad debt",
          collateralAmount: "10",
          collateralFactor: "0.7",
          liquidatorIncentiveBps: "10500",
          treasuryFeeBps: "5000",
          closeFactorBps: "5000",
          debtFloor: "100",
          drawStablecoinAmount: "2000",
          startingPrice: "420",
          nextPrice: "200",
          debtShareToRepay: "200",
          expectedDebtValueToRepay: "1904.761905",
          expectedSeizedCollateral: "10",
          expectedDebtShareAfterLiquidation: "0",
          expectedSystemBadDebt: "95.238095",
        },
        {
          label: "safety buffer -10%, position collateral is fully liquidated because debt floor",
          collateralAmount: "10",
          collateralFactor: "0.7",
          liquidatorIncentiveBps: "10500",
          treasuryFeeBps: "5000",
          closeFactorBps: "5000",
          debtFloor: "1500",
          drawStablecoinAmount: "2000",
          startingPrice: "420",
          nextPrice: "250",
          debtShareToRepay: "1000",
          expectedDebtValueToRepay: "2000",
          expectedSeizedCollateral: "8.4",
          expectedDebtShareAfterLiquidation: "0",
          expectedSystemBadDebt: "0",
        },
        {
          label:
            "safety buffer -5.71% with 99% collateral factor, position is liquidated up to full close factor, bad debt",
          collateralAmount: "2000",
          collateralFactor: "0.99",
          liquidatorIncentiveBps: "10500",
          treasuryFeeBps: "5000",
          closeFactorBps: "5000",
          debtFloor: "100",
          drawStablecoinAmount: "1975",
          startingPrice: "1",
          nextPrice: "0.99",
          debtShareToRepay: "987.5",
          expectedDebtValueToRepay: "1885.714286",
          expectedSeizedCollateral: "2000",
          expectedDebtShareAfterLiquidation: "0",
          expectedSystemBadDebt: "89.285714",
        },
        {
          label:
            "safety buffer -5.71% with 99% collateral factor, position collateral is fully liquidated because debt floor",
          collateralAmount: "2000",
          collateralFactor: "0.9",
          liquidatorIncentiveBps: "10500",
          treasuryFeeBps: "5000",
          closeFactorBps: "5000",
          debtFloor: "100",
          drawStablecoinAmount: "1800",
          startingPrice: "1",
          nextPrice: "0.99",
          debtShareToRepay: "900",
          expectedDebtValueToRepay: "900",
          expectedSeizedCollateral: "954.5455",
          expectedDebtShareAfterLiquidation: "900",
          expectedSystemBadDebt: "0",
        },
        {
          label:
            "safety buffer -7.83% with 99% collateral factor, position is liquidated up to full close factor, bad debt",
          collateralAmount: "2000",
          collateralFactor: "0.9",
          liquidatorIncentiveBps: "10500",
          treasuryFeeBps: "5000",
          closeFactorBps: "5000",
          debtFloor: "100",
          drawStablecoinAmount: "1800",
          startingPrice: "1",
          nextPrice: "0.92",
          debtShareToRepay: "900",
          expectedDebtValueToRepay: "1752.380952",
          expectedSeizedCollateral: "2000",
          expectedDebtShareAfterLiquidation: "0",
          expectedSystemBadDebt: "47.619048",
        },
        {
          label:
            "safety buffer -8.90% with 99% collateral factor, position is liquidated up to full close factor, bad debt",
          collateralAmount: "2000",
          collateralFactor: "0.9",
          liquidatorIncentiveBps: "10500",
          treasuryFeeBps: "5000",
          closeFactorBps: "2500",
          debtFloor: "100",
          drawStablecoinAmount: "1800",
          startingPrice: "1",
          nextPrice: "0.91",
          debtShareToRepay: "450",
          expectedDebtValueToRepay: "1733.333333",
          expectedSeizedCollateral: "2000",
          expectedDebtShareAfterLiquidation: "0",
          expectedSystemBadDebt: "66.666667",
        },
        {
          label:
            "safety buffer -0.91% with 99% collateral factor, position collateral is fully liquidated because debt floor",
          collateralAmount: "555.560",
          collateralFactor: "0.9",
          liquidatorIncentiveBps: "10500",
          treasuryFeeBps: "5000",
          closeFactorBps: "2500",
          debtFloor: "500",
          drawStablecoinAmount: "500",
          startingPrice: "1",
          nextPrice: "0.99",
          debtShareToRepay: "125",
          expectedDebtValueToRepay: "500",
          expectedSeizedCollateral: "530.3030303",
          expectedDebtShareAfterLiquidation: "0",
          expectedSystemBadDebt: "0",
        },
        {
          label: "safety buffer -0.91% with 99% collateral factor, position is liquidated up to full close factor",
          collateralAmount: "555.560",
          collateralFactor: "0.9",
          liquidatorIncentiveBps: "10500",
          treasuryFeeBps: "5000",
          closeFactorBps: "2500",
          debtFloor: "100",
          drawStablecoinAmount: "500",
          startingPrice: "1",
          nextPrice: "0.99",
          debtShareToRepay: "125",
          expectedDebtValueToRepay: "125",
          expectedSeizedCollateral: "132.5758",
          expectedDebtShareAfterLiquidation: "375.00",
          expectedSystemBadDebt: "0",
        },
      ]
      for (let i = 0; i < testParams.length; i++) {
        const testParam = testParams[i]
        it(testParam.label, async () => {
          await ibDUMMY.mint(aliceAddress, parseEther(testParam.collateralAmount))
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

          // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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

          await ibDUMMYasAlice.approve(aliceProxyWallet.address, lockedCollateralAmount)
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
          const alicePositionAddress = await positionManager.positions(1)
          const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
          const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          expect(
            alicePosition.lockedCollateral,
            "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
          ).to.be.equal(lockedCollateralAmount)
          expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
            drawStablecoinAmount
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(
            drawStablecoinAmount
          )
          expect(
            await alpacaToken.balanceOf(aliceProxyWallet.address),
            "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
          ).to.be.equal(0)

          // 3. ibDUMMY price drop to 0.99 USD
          await simplePriceFeedAsDeployer.setPrice(parseUnits(testParam.nextPrice, 18))
          await collateralPoolConfig.setPriceWithSafetyMargin(
            COLLATERAL_POOL_ID,
            parseUnits(testParam.nextPrice, 18).mul(parseUnits(testParam.collateralFactor, 18)).div(parseUnits("1", 9))
          )

          // 4. Bob liquidate Alice's position up to full close factor successfully
          const debtShareToRepay = parseEther(testParam.debtShareToRepay)
          await bookKeeperAsBob.whitelist(liquidationEngine.address)
          await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
          await bookKeeper.mintUnbackedStablecoin(
            deployerAddress,
            bobAddress,
            parseUnits(testParam.debtShareToRepay, 46)
          )
          const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
          await liquidationEngineAsBob.liquidate(
            COLLATERAL_POOL_ID,
            alicePositionAddress,
            debtShareToRepay,
            MaxUint256,
            bobAddress,
            "0x"
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

    context("1st liquidation keep position unsafe, 2nd position fully liquidate the position", async () => {
      it("should success", async () => {
        const testParam = {
          label: "safety buffer -0.18%, position is liquidated up to full close factor",
          collateralAmount: "10",
          collateralFactor: "0.7",
          liquidatorIncentiveBps: "10500",
          treasuryFeeBps: "5000",
          closeFactorBps: "5000",
          debtFloor: "100",
          drawStablecoinAmount: "2000",
          startingPrice: "420",
          nextPrice: "250",
          debtShareToRepay: "200",
          expectedDebtValueToRepay: "200",
          expectedSeizedCollateral: "0.84",
          expectedDebtShareAfterLiquidation: "1800",
          expectedSystemBadDebt: "0",
        }
        it(testParam.label, async () => {
          await ibDUMMY.mint(aliceAddress, parseEther(testParam.collateralAmount))
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

          // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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

          await ibDUMMYasAlice.approve(aliceProxyWallet.address, lockedCollateralAmount)
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
          const alicePositionAddress = await positionManager.positions(1)
          const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
          const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          expect(
            alicePosition.lockedCollateral,
            "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
          ).to.be.equal(lockedCollateralAmount)
          expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
            drawStablecoinAmount
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(
            drawStablecoinAmount
          )
          expect(
            await alpacaToken.balanceOf(aliceProxyWallet.address),
            "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
          ).to.be.equal(0)

          // 3. ibDUMMY price drop to 0.99 USD
          await simplePriceFeedAsDeployer.setPrice(parseUnits(testParam.nextPrice, 18))
          await collateralPoolConfig.setPriceWithSafetyMargin(
            COLLATERAL_POOL_ID,
            parseUnits(testParam.nextPrice, 18).mul(parseUnits(testParam.collateralFactor, 18)).div(parseUnits("1", 9))
          )

          // 4. Bob liquidate Alice's position up to full close factor successfully
          const debtShareToRepay = parseEther(testParam.debtShareToRepay)
          await bookKeeperAsBob.whitelist(liquidationEngine.address)
          await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
          await bookKeeper.mintUnbackedStablecoin(
            deployerAddress,
            bobAddress,
            parseUnits(testParam.debtShareToRepay, 46)
          )
          const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
          await liquidationEngineAsBob.liquidate(
            COLLATERAL_POOL_ID,
            alicePositionAddress,
            debtShareToRepay,
            MaxUint256,
            bobAddress,
            "0x"
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

          // Second Liquidation
          await liquidationEngineAsBob.liquidate(
            COLLATERAL_POOL_ID,
            alicePositionAddress,
            MaxUint256,
            MaxUint256,
            bobAddress,
            "0x"
          )
          const alicePositionAfterLiquidation2 = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          expect(alicePositionAfterLiquidation2.lockedCollateral).to.be.eq(parseEther("4.62"))
          expect(alicePositionAfterLiquidation2.debtShare).to.be.eq(parseEther("900"))
        })
      })
    })

    context("price feed is manipulated", async () => {
      it("should revert, preventing position from being liquidated", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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
          defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. ibDUMMY price drop to 0.99 USD
        await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.sub(1))
        await simplePriceFeedAsDeployer.setPrice(WeiPerRay.sub(1).div(1e9))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = parseEther("0.5")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await simplePriceFeed.setPriceLife(60 * 60) // 1 hour
        await TimeHelpers.increase(TimeHelpers.duration.seconds(ethers.BigNumber.from(60 * 60 * 2))) // move forward 2 hours
        await expect(
          liquidationEngineAsBob.liquidate(
            COLLATERAL_POOL_ID,
            alicePositionAddress,
            debtShareToRepay,
            MaxUint256,
            bobAddress,
            defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
          )
        ).to.be.revertedWith("FixedSpreadLiquidationStrategy/invalid-price")
      })
    })

    context(
      "safety buffer -20%, position is liquidated up to full close factor with some interest and debt floor",
      async () => {
        it("should success", async () => {
          // 1. Set priceWithSafetyMargin for ibDUMMY to 420 USD
          await simplePriceFeedAsDeployer.setPrice(parseUnits("420", 18))
          await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, parseUnits("294", 27))
          await collateralPoolConfig.setDebtFloor(COLLATERAL_POOL_ID, parseEther("100").mul(WeiPerRay))

          // 2. Alice open a new position with 10 ibDUMMY and draw 2000 AUSD
          const lockedCollateralAmount = parseEther("10")
          const drawStablecoinAmount = parseEther("2000")
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
          await ibDUMMYasAlice.approve(aliceProxyWallet.address, lockedCollateralAmount)
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)

          // Set stability fee rate to 0.5% APR
          await collateralPoolConfig.setStabilityFeeRate(
            COLLATERAL_POOL_ID,
            BigNumber.from("1000000000158153903837946258")
          )

          const alicePositionAddress = await positionManager.positions(1)
          const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
          const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

          expect(
            alicePosition.lockedCollateral,
            "lockedCollateral should be 10 ibDUMMY, because Alice locked 10 ibDUMMY"
          ).to.be.equal(parseEther("10"))
          expect(alicePosition.debtShare, "debtShare should be 2000 AUSD, because Alice drew 2000 AUSD").to.be.equal(
            parseEther("2000")
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 2000 AUSD from drawing 2000 AUSD").to.be.equal(
            parseEther("2000")
          )
          expect(
            await alpacaToken.balanceOf(aliceProxyWallet.address),
            "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
          ).to.be.equal(0)

          // 3. 1 year passed, ibDUMMY price drop to 285 USD
          await TimeHelpers.increase(TimeHelpers.duration.seconds(ethers.BigNumber.from("31536000")))
          await stabilityFeeCollector.collect(COLLATERAL_POOL_ID)
          const aliceDebtValueAfterOneYear = (
            await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          ).debtShare.mul((await collateralPoolConfig.collateralPools(COLLATERAL_POOL_ID)).debtAccumulatedRate)
          AssertHelpers.assertAlmostEqual(
            aliceDebtValueAfterOneYear.toString(),
            parseEther("2010").mul(WeiPerRay).toString()
          )
          await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, parseUnits("199.5", 27))
          await simplePriceFeedAsDeployer.setPrice(parseEther("285"))

          // 4. Bob liquidate Alice's position up to full close factor successfully
          const debtShareToRepay = parseEther("1000")
          await bookKeeperAsBob.whitelist(liquidationEngine.address)
          await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
          await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, parseUnits("3000", 45))
          const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
          await liquidationEngineAsBob.liquidate(
            COLLATERAL_POOL_ID,
            alicePositionAddress,
            debtShareToRepay,
            MaxUint256,
            bobAddress,
            defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
          )

          // 5. Settle system bad debt
          await systemDebtEngine.settleSystemBadDebt(await bookKeeper.systemBadDebt(systemDebtEngine.address))
          AssertHelpers.assertAlmostEqual(
            (await bookKeeper.stablecoin(systemDebtEngine.address)).toString(),
            parseEther("10").mul(WeiPerRay).toString()
          ) // There should be 10 AUSD left in SystemDebtEngine collected from stability fee after `settleSystemBadDebt`

          const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

          const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

          AssertHelpers.assertAlmostEqual(
            alicePositionAfterLiquidation.lockedCollateral.toString(),
            parseEther("6.297").toString()
          )
          expect(
            alicePositionAfterLiquidation.debtShare,
            "debtShare should be 1000 AUSD, because Bob liquidated 1000 AUSD from Alice's position"
          )
            .to.be.equal(alicePosition.debtShare.sub(debtShareToRepay))
            .to.be.equal(parseEther("1000"))
          expect(
            await bookKeeper.systemBadDebt(systemDebtEngine.address),
            "System bad debt should be 0 AUSD"
          ).to.be.equal(0)
          AssertHelpers.assertAlmostEqual(
            (await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress)).toString(),
            parseEther("3.61447369").toString()
          ) // Bob should receive 3.61447369 ibDUMMY
          AssertHelpers.assertAlmostEqual(
            bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation).toString(),
            parseEther("1005").mul(WeiPerRay).toString()
          ) // Bob should pay 1005 AUSD for this liquidation
          AssertHelpers.assertAlmostEqual(
            (await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address)).toString(),
            parseEther("0.08815789").toString()
          ) // SystemDebtEngine should receive 0.08815789 ibDUMMY as treasury fee
          expect(
            await alpacaToken.balanceOf(aliceProxyWallet.address),
            "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
          ).to.not.equal(0)
        })
      }
    )
  })
})
