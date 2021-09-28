import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"

import {
  ProxyWalletRegistry__factory,
  ProxyWalletFactory__factory,
  ProxyWalletRegistry,
  ProxyWallet__factory,
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
} from "../../../typechain"
import { expect } from "chai"
import { AddressZero } from "../../helper/address"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"
import { loadProxyWalletFixtureHandler } from "../../helper/proxy"

const { parseEther, formatBytes32String } = ethers.utils

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
}

const ALPACA_PER_BLOCK = ethers.utils.parseEther("100")
const COLLATERAL_POOL_ID = formatBytes32String("ibDUMMY")
const CLOSE_FACTOR_BPS = BigNumber.from(5000)
const LIQUIDATOR_INCENTIVE_BPS = BigNumber.from(250)
const TREASURY_FEE_BPS = BigNumber.from(100)
const BPS = BigNumber.from(10000)

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer, alice, bob, dev] = await ethers.getSigners()

  const ProxyWalletFactory = new ProxyWalletFactory__factory(deployer)
  const proxyWalletFactory = await ProxyWalletFactory.deploy()

  const ProxyWalletRegistry = new ProxyWalletRegistry__factory(deployer)
  const proxyWalletRegistry = (await upgrades.deployProxy(ProxyWalletRegistry, [
    proxyWalletFactory.address,
  ])) as ProxyWalletRegistry

  // Deploy mocked BookKeeper
  const BookKeeper = (await ethers.getContractFactory("BookKeeper", deployer)) as BookKeeper__factory
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [])) as BookKeeper
  await bookKeeper.deployed()

  await bookKeeper.init(COLLATERAL_POOL_ID)
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(1000))
  await bookKeeper.setDebtCeiling(COLLATERAL_POOL_ID, WeiPerRad.mul(1000))

  await bookKeeper.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployer.address)
  await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const ibDUMMY = await BEP20.deploy("ibDUMMY", "ibDUMMY")
  await ibDUMMY.deployed()
  await ibDUMMY.mint(await alice.getAddress(), ethers.utils.parseEther("100"))
  await ibDUMMY.mint(await bob.getAddress(), ethers.utils.parseEther("100"))

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
  await fairLaunch.addPool(1, ibDUMMY.address, true)
  await fairLaunch.transferOwnership(shield.address)
  await shield.transferOwnership(await deployer.getAddress())
  await alpacaToken.transferOwnership(fairLaunch.address)

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
  ])) as IbTokenAdapter
  await ibTokenAdapter.deployed()

  await bookKeeper.grantRole(ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]), ibTokenAdapter.address)
  await bookKeeper.grantRole(await bookKeeper.MINTABLE_ROLE(), deployer.address)

  // Deploy Alpaca Stablecoin
  const AlpacaStablecoin = (await ethers.getContractFactory("AlpacaStablecoin", deployer)) as AlpacaStablecoin__factory
  const alpacaStablecoin = await AlpacaStablecoin.deploy("Alpaca USD", "AUSD", "31337")
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

  // Deploy PositionManager
  const PositionManager = (await ethers.getContractFactory("PositionManager", deployer)) as PositionManager__factory
  const positionManager = (await upgrades.deployProxy(PositionManager, [bookKeeper.address])) as PositionManager
  await positionManager.deployed()
  await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), positionManager.address)

  // Deploy StabilityFeeCollector
  const StabilityFeeCollector = (await ethers.getContractFactory(
    "StabilityFeeCollector",
    deployer
  )) as StabilityFeeCollector__factory
  const stabilityFeeCollector = (await upgrades.deployProxy(StabilityFeeCollector, [
    bookKeeper.address,
  ])) as StabilityFeeCollector
  await stabilityFeeCollector.init(COLLATERAL_POOL_ID)
  await bookKeeper.grantRole(await bookKeeper.STABILITY_FEE_COLLECTOR_ROLE(), stabilityFeeCollector.address)

  const SystemDebtEngine = (await ethers.getContractFactory("SystemDebtEngine", deployer)) as SystemDebtEngine__factory
  const systemDebtEngine = (await upgrades.deployProxy(SystemDebtEngine, [bookKeeper.address])) as SystemDebtEngine

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
    positionManager.address,
  ])) as FixedSpreadLiquidationStrategy
  await liquidationEngine.setStrategy(COLLATERAL_POOL_ID, fixedSpreadLiquidationStrategy.address)
  await fixedSpreadLiquidationStrategy.setCollateralPool(
    COLLATERAL_POOL_ID,
    ibTokenAdapter.address,
    CLOSE_FACTOR_BPS,
    LIQUIDATOR_INCENTIVE_BPS,
    TREASURY_FEE_BPS
  )
  await fixedSpreadLiquidationStrategy.grantRole(
    await fixedSpreadLiquidationStrategy.LIQUIDATION_ENGINE_ROLE(),
    liquidationEngine.address
  )
  await bookKeeper.grantRole(await bookKeeper.LIQUIDATION_ENGINE_ROLE(), liquidationEngine.address)
  await bookKeeper.grantRole(await bookKeeper.LIQUIDATION_ENGINE_ROLE(), fixedSpreadLiquidationStrategy.address)

  const SimplePriceFeed = (await ethers.getContractFactory("SimplePriceFeed", deployer)) as SimplePriceFeed__factory
  const simplePriceFeed = (await upgrades.deployProxy(SimplePriceFeed, [])) as SimplePriceFeed
  await simplePriceFeed.deployed()
  await priceOracle.setPriceFeed(COLLATERAL_POOL_ID, simplePriceFeed.address)

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
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

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
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
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
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

        // 4. Bob try to liquidate Alice's position but failed due to the price did not drop low enough
        await expect(
          liquidationEngineAsBob.liquidate(COLLATERAL_POOL_ID, alicePositionAddress, 1, "0x")
        ).to.be.revertedWith("LiquidationEngine/not-unsafe")
      })
    })

    context("safety buffer -0.1%, position is liquidated up to full close factor", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

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
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
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

        // 3. ibDUMMY price drop to 0.99 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.sub(1))
        await simplePriceFeedAsDeployer.setPrice(WeiPerRay.sub(1).div(1e9))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = ethers.utils.parseEther("0.5")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )
        const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
        const expectedSeizedCollateral = lockedCollateralAmount.mul(CLOSE_FACTOR_BPS).div(BPS)
        const expectedLiquidatorIncentive = expectedSeizedCollateral.mul(LIQUIDATOR_INCENTIVE_BPS).div(BPS)
        const expectedTreasuryFee = expectedSeizedCollateral.mul(TREASURY_FEE_BPS).div(BPS)
        const expectedSeizedCollateralWithAllFees = expectedSeizedCollateral
          .add(expectedLiquidatorIncentive)
          .add(expectedTreasuryFee)
        const expectedCollateralBobShouldReceive = expectedSeizedCollateral.add(expectedLiquidatorIncentive)

        expect(
          alicePositionAfterLiquidation.lockedCollateral,
          "lockedCollateral should be 0.4825 ibDUMMY after including liquidator incentive and treasury fee"
        )
          .to.be.equal(lockedCollateralAmount.sub(expectedSeizedCollateralWithAllFees))
          .to.be.equal(ethers.utils.parseEther("0.4825"))
        expect(
          alicePositionAfterLiquidation.debtShare,
          "debtShare should be 0.5 AUSD, because Bob liquidated 0.5 AUSD from Alice's position"
        )
          .to.be.equal(alicePosition.debtShare.sub(debtShareToRepay))
          .to.be.equal(ethers.utils.parseEther("0.5"))
        expect(await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress), "Bob should receive 0.5125 ibDUMMY")
          .to.be.equal(expectedCollateralBobShouldReceive)
          .to.be.equal(ethers.utils.parseEther("0.5125"))
        expect(
          bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation),
          "Bob should pay 0.5 AUSD for this liquidation"
        ).to.be.equal(ethers.utils.parseEther("0.5").mul(WeiPerRay))
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address),
          "SystemDebtEngine should receive 0.005 ibDUMMY as treasury fee"
        )
          .to.be.equal(expectedTreasuryFee)
          .to.be.equal(ethers.utils.parseEther("0.005"))
      })
    })
  })
})
