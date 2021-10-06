import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"

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
  PriceOracle,
  PriceOracle__factory,
  SimplePriceFeed__factory,
  SimplePriceFeed,
} from "../../typechain"
import { expect } from "chai"
import { AddressZero } from "../helper/address"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../helper/unit"
import { loadProxyWalletFixtureHandler } from "../helper/proxy"
import { FixedSpreadLiquidationStrategy } from "../../typechain/FixedSpreadLiquidationStrategy"
import { FixedSpreadLiquidationStrategy__factory } from "../../typechain/factories/FixedSpreadLiquidationStrategy__factory"

const { parseEther, formatBytes32String } = ethers.utils

type fixture = {
  proxyWalletRegistry: ProxyWalletRegistry
  ibTokenAdapter: IbTokenAdapter
  ibTokenAdapter2: IbTokenAdapter
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
const COLLATERAL_POOL_ID2 = formatBytes32String("ibDUMMY2")
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

  await bookKeeper.init(COLLATERAL_POOL_ID2)
  await bookKeeper.setDebtCeiling(COLLATERAL_POOL_ID2, WeiPerRad.mul(1000))

  await bookKeeper.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployer.address)
  await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

  await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID2, WeiPerRay)

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

  const ibTokenAdapter2 = (await upgrades.deployProxy(IbTokenAdapter, [
    bookKeeper.address,
    COLLATERAL_POOL_ID2,
    ibDUMMY.address,
    alpacaToken.address,
    fairLaunch.address,
    0,
    shield.address,
    await deployer.getAddress(),
    BigNumber.from(1000),
    await dev.getAddress(),
  ])) as IbTokenAdapter
  await ibTokenAdapter2.deployed()

  await bookKeeper.grantRole(ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]), ibTokenAdapter.address)
  await bookKeeper.grantRole(ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]), ibTokenAdapter2.address)
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
  await stabilityFeeCollector.init(COLLATERAL_POOL_ID2)
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
  await liquidationEngine.setStrategy(COLLATERAL_POOL_ID2, fixedSpreadLiquidationStrategy.address)
  await fixedSpreadLiquidationStrategy.setCollateralPool(
    COLLATERAL_POOL_ID,
    ibTokenAdapter.address,
    CLOSE_FACTOR_BPS,
    LIQUIDATOR_INCENTIVE_BPS,
    TREASURY_FEE_BPS
  )
  await fixedSpreadLiquidationStrategy.setCollateralPool(
    COLLATERAL_POOL_ID2,
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
  await priceOracle.setPriceFeed(COLLATERAL_POOL_ID2, simplePriceFeed.address)

  return {
    proxyWalletRegistry,
    ibTokenAdapter,
    ibTokenAdapter2,
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

describe("PositionPermissions", () => {
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

  let deployerProxyWallet: ProxyWallet
  let aliceProxyWallet: ProxyWallet
  let bobProxyWallet: ProxyWallet

  let ibTokenAdapter: IbTokenAdapter
  let ibTokenAdapter2: IbTokenAdapter

  let stablecoinAdapter: StablecoinAdapter
  let stablecoinAdapterAsAlice: StablecoinAdapter
  let stablecoinAdapterAsBob: StablecoinAdapter

  let bookKeeper: BookKeeper
  let ibDUMMY: BEP20

  let positionManager: PositionManager
  let positionManagerAsAlice: PositionManager
  let positionManagerAsBob: PositionManager

  let stabilityFeeCollector: StabilityFeeCollector

  let liquidationEngine: LiquidationEngine

  let alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions

  let alpacaStablecoin: AlpacaStablecoin

  let simplePriceFeed: SimplePriceFeed

  let ibDUMMYasAlice: BEP20
  let ibDUMMYasBob: BEP20

  let bookKeeperAsAlice: BookKeeper
  let bookKeeperAsBob: BookKeeper

  before(async () => {
    ;({
      proxyWallets: [deployerProxyWallet, aliceProxyWallet, bobProxyWallet],
    } = await waffle.loadFixture(loadProxyWalletFixtureHandler))
  })

  beforeEach(async () => {
    ;({
      proxyWalletRegistry,
      ibTokenAdapter,
      ibTokenAdapter2,
      stablecoinAdapter,
      bookKeeper,
      ibDUMMY,
      alpacaStablecoinProxyActions,
      positionManager,
      stabilityFeeCollector,
      alpacaStablecoin,
      liquidationEngine,
      simplePriceFeed,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])

    ibDUMMYasAlice = BEP20__factory.connect(ibDUMMY.address, alice)
    ibDUMMYasBob = BEP20__factory.connect(ibDUMMY.address, bob)

    stablecoinAdapterAsAlice = StablecoinAdapter__factory.connect(stablecoinAdapter.address, alice)
    stablecoinAdapterAsBob = StablecoinAdapter__factory.connect(stablecoinAdapter.address, bob)

    bookKeeperAsAlice = BookKeeper__factory.connect(bookKeeper.address, alice)
    bookKeeperAsBob = BookKeeper__factory.connect(bookKeeper.address, bob)

    positionManagerAsAlice = PositionManager__factory.connect(positionManager.address, alice)
    positionManagerAsBob = PositionManager__factory.connect(positionManager.address, bob)
  })
  describe("#permissions", async () => {
    context("position owner is able to", async () => {
      context("lock collateral into their own position", async () => {
        it("should success", async () => {
          // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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
          expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
            WeiPerWad
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)

          // 2. Alice try to adjust position, add 2 ibDummy to position
          const lockToken = alpacaStablecoinProxyActions.interface.encodeFunctionData("lockToken", [
            positionManager.address,
            ibTokenAdapter.address,
            await positionManager.ownerLastPositionId(aliceProxyWallet.address),
            WeiPerWad.mul(2),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, lockToken)
          const aliceAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          expect(
            aliceAdjustPosition.lockedCollateral,
            "lockedCollateral should be 3 ibDUMMY, because Alice locked 2 more ibDUMMY"
          ).to.be.equal(WeiPerWad.mul(3))
          expect(
            aliceAdjustPosition.debtShare,
            "debtShare should be 1 AUSD, because Alice didn't draw more"
          ).to.be.equal(WeiPerWad)
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        })
      })

      context("move collateral", async () => {
        context("same collateral pool", async () => {
          context(
            "call openLockTokenAndDraw, unlock collateral and move the collateral from one position to another position within the same collateral pool",
            async () => {
              it("should success", async () => {
                // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
                const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "openLockTokenAndDraw",
                  [
                    positionManager.address,
                    stabilityFeeCollector.address,
                    ibTokenAdapter.address,
                    stablecoinAdapter.address,
                    COLLATERAL_POOL_ID,
                    WeiPerWad,
                    WeiPerWad,
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                  ]
                )
                await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
                const alicePositionAddress = await positionManager.positions(1)
                const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
                const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
                expect(
                  alicePosition.lockedCollateral,
                  "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                  WeiPerWad
                )
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                  "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
                ).to.be.equal(0)
                expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(
                  WeiPerWad
                )
                // 2. Alice open a second new position with 2 ibDUMMY and draw 1 AUSD at same collateral pool
                const openPositionCall2 = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "openLockTokenAndDraw",
                  [
                    positionManager.address,
                    stabilityFeeCollector.address,
                    ibTokenAdapter.address,
                    stablecoinAdapter.address,
                    COLLATERAL_POOL_ID,
                    WeiPerWad.mul(2),
                    WeiPerWad,
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                  ]
                )
                await aliceProxyWallet["execute(address,bytes)"](
                  alpacaStablecoinProxyActions.address,
                  openPositionCall2
                )
                const alicePositionAddress2 = await positionManager.positions(2)
                const alpacaStablecoinBalance2 = await alpacaStablecoin.balanceOf(aliceAddress)
                const alicePosition2 = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress2)
                expect(
                  alicePosition2.lockedCollateral,
                  "lockedCollateral should be 2 ibDUMMY, because Alice locked 2 ibDUMMY"
                ).to.be.equal(WeiPerWad.mul(2))
                expect(alicePosition2.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                  WeiPerWad
                )
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress2),
                  "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
                ).to.be.equal(0)
                expect(
                  alpacaStablecoinBalance2,
                  "Alice should receive 2 AUSD from drawing AUSD 2 times form 2 positions"
                ).to.be.equal(WeiPerWad.mul(2))
                // 3. Alice try to unlock 1 ibDUMMY at second position
                const adjustPosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("adjustPosition", [
                  positionManager.address,
                  await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                  WeiPerWad.mul(-1),
                  0,
                  ibTokenAdapter.address,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ])
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, adjustPosition)
                const aliceAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress2)
                expect(
                  aliceAdjustPosition.lockedCollateral,
                  "Position #2's lockedCollateral should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY from it"
                ).to.be.equal(WeiPerWad)
                expect(
                  aliceAdjustPosition.debtShare,
                  "debtShare should be 1 AUSD, because Alice didn't draw more"
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress2),
                  "collateralToken inside Alice's Position#2 address should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY from the position"
                ).to.be.equal(WeiPerWad)
                // 4. Alice try to move collateral from second position to first position
                const moveCollateral = alpacaStablecoinProxyActions.interface.encodeFunctionData("moveCollateral", [
                  positionManager.address,
                  await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                  alicePositionAddress,
                  WeiPerWad,
                  ibTokenAdapter.address,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ])
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, moveCollateral)
                const aliceMoveCollateral = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
                const alpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
                expect(
                  aliceMoveCollateral.lockedCollateral,
                  "Alice's Position #1 lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(
                  aliceMoveCollateral.debtShare,
                  "Alice's Position #1 debtShare should be 1 AUSD, because Alice doesn't draw more"
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                  "collateralToken inside Alice's Position #1 address should be 1 ibDUMMY, because Alice moved 1 ibDUMMY from Position #2 to Position #1."
                ).to.be.equal(WeiPerWad)
                expect(
                  alpacaStablecoinBalancefinal,
                  "Alice should receive 2 AUSD from drawing 2 AUSD, because Alice draw 2 times"
                ).to.be.equal(WeiPerWad.mul(2))
              })
            }
          )
          context(
            "open position, deposit collateral and move collateral from one position to another position",
            async () => {
              it("should success", async () => {
                // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
                const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "openLockTokenAndDraw",
                  [
                    positionManager.address,
                    stabilityFeeCollector.address,
                    ibTokenAdapter.address,
                    stablecoinAdapter.address,
                    COLLATERAL_POOL_ID,
                    WeiPerWad,
                    WeiPerWad,
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                  ]
                )
                await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
                const alicePositionAddress = await positionManager.positions(1)
                const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
                const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
                expect(
                  alicePosition.lockedCollateral,
                  "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                  WeiPerWad
                )
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                  "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
                ).to.be.equal(0)
                expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(
                  WeiPerWad
                )
                // 2. Alice open a second new position at same collateral pool
                const openPositionCall2 = alpacaStablecoinProxyActions.interface.encodeFunctionData("open", [
                  positionManager.address,
                  COLLATERAL_POOL_ID,
                  aliceProxyWallet.address,
                ])
                await aliceProxyWallet["execute(address,bytes)"](
                  alpacaStablecoinProxyActions.address,
                  openPositionCall2
                )
                const alicePositionAddress2 = await positionManager.positions(2)
                const alicePosition2 = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress2)
                expect(
                  alicePosition2.lockedCollateral,
                  "lockedCollateral should be 0 ibDUMMY, because Alice doesn't locked ibDUMMY"
                ).to.be.equal(0)
                expect(alicePosition2.debtShare, "debtShare should be 0 AUSD, because doesn't drew AUSD").to.be.equal(0)
                // 3. Alice deposit 3 ibDUMMY to new position
                const depositPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "tokenAdapterDeposit",
                  [
                    ibTokenAdapter.address,
                    await positionManager.positions(2),
                    WeiPerWad.mul(3),
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                  ]
                )
                await aliceProxyWallet["execute(address,bytes)"](
                  alpacaStablecoinProxyActions.address,
                  depositPositionCall
                )
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress2),
                  "collateralToken inside Alice's second position address should be 3 ibDUMMY, because Alice deposit 3 ibDUMMY into the second position"
                ).to.be.equal(WeiPerWad.mul(3))
                // 4. Alice try to move collateral from second position to first position
                const moveCollateral = alpacaStablecoinProxyActions.interface.encodeFunctionData("moveCollateral", [
                  positionManager.address,
                  await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                  alicePositionAddress,
                  WeiPerWad,
                  ibTokenAdapter.address,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ])
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, moveCollateral)
                const aliceMoveCollateral = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
                const alpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
                expect(
                  aliceMoveCollateral.lockedCollateral,
                  "Alice's Position #1 lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(
                  aliceMoveCollateral.debtShare,
                  "Alice's Position #1 debtShare should be 1 AUSD, because Alice doesn't draw more"
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                  "collateralToken inside Alice's Position #1 address should be 1 ibDUMMY, because Alice moved 1 ibDUMMY from Position #2 to Position #1."
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress2),
                  "collateralToken inside Alice's Position #2 address should be 2 ibDUMMY, because Alice moved 1 ibDUMMY to Position #1"
                ).to.be.equal(WeiPerWad.mul(2))
                expect(
                  alpacaStablecoinBalancefinal,
                  "Alice should receive 1 AUSD, because Alice draw 1 time"
                ).to.be.equal(WeiPerWad)
              })
            }
          )
          context("Alice open a position, lock collateral and move collateral to Bob's position", async () => {
            it("should success", async () => {
              // 1. Alice open position
              const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("open", [
                positionManager.address,
                COLLATERAL_POOL_ID,
                aliceProxyWallet.address,
              ])
              await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
              await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
              const alicePositionAddress = await positionManager.positions(1)
              const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
              expect(
                alicePosition.lockedCollateral,
                "lockedCollateral should be 0 ibDUMMY, because Alice doesn't locked ibDUMMY"
              ).to.be.equal(0)
              expect(alicePosition.debtShare, "debtShare should be 0 AUSD, because doesn't drew AUSD").to.be.equal(0)
              // 2. Alice deposit 3 ibDUMMY to new position
              const depositPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "tokenAdapterDeposit",
                [
                  ibTokenAdapter.address,
                  await positionManager.positions(1),
                  WeiPerWad.mul(3),
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ]
              )
              await aliceProxyWallet["execute(address,bytes)"](
                alpacaStablecoinProxyActions.address,
                depositPositionCall
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's second position address should be 3 ibDUMMY, because Alice deposit 3 ibDUMMY into the second position"
              ).to.be.equal(WeiPerWad.mul(3))
              // 3. Bob open a position with 1 ibDUMMY and draw 1 AUSD
              const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "openLockTokenAndDraw",
                [
                  positionManager.address,
                  stabilityFeeCollector.address,
                  ibTokenAdapter.address,
                  stablecoinAdapter.address,
                  COLLATERAL_POOL_ID,
                  WeiPerWad,
                  WeiPerWad,
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
                ]
              )
              await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
              await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobOpenPositionCall)
              const bobPositionAddress = await positionManager.positions(2)
              const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
              const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, bobPositionAddress)
              expect(
                bobPosition.lockedCollateral,
                "lockedCollateral should be 1 ibDUMMY, because Bob locked 1 ibDUMMY"
              ).to.be.equal(WeiPerWad)
              expect(bobPosition.debtShare, "debtShare should be 1 AUSD, because Bob drew 1 AUSD").to.be.equal(
                WeiPerWad
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
                "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
              ).to.be.equal(0)
              expect(alpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
              // 4. Alice try to move collateral to bob position
              const moveCollateral = alpacaStablecoinProxyActions.interface.encodeFunctionData("moveCollateral", [
                positionManager.address,
                await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                bobPositionAddress,
                WeiPerWad,
                ibTokenAdapter.address,
                ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
              ])
              await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, moveCollateral)
              const aliceAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
              const bobAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(bobAddress)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's Position address should be 2 ibDUMMY, because Alice move 1 ibDUMMY from Alice's Position to Bob's Position."
              ).to.be.equal(WeiPerWad.mul(2))
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
                "collateralToken inside Bob's Position address should be 1 ibDUMMY, because Alice moved 1 ibDUMMY from Alice's Position to Bob's position"
              ).to.be.equal(WeiPerWad)
              expect(
                aliceAlpacaStablecoinBalancefinal,
                "Alice should receive 0 AUSD, because Alice doesn't draw"
              ).to.be.equal(0)
              expect(bobAlpacaStablecoinBalancefinal, "Bob should receive 1 AUSD, because Bob draw 1 time").to.be.equal(
                WeiPerWad
              )
            })
          })
        })
        context("between 2 collateral pool", async () => {
          context(
            "Alice opens 2 positions on 2 collateral pools (one position for each collateral pool) and Alice move collateral from one position to another position by calling function openLockTokenAndDraw",
            async () => {
              it("should success", async () => {
                // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
                const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "openLockTokenAndDraw",
                  [
                    positionManager.address,
                    stabilityFeeCollector.address,
                    ibTokenAdapter.address,
                    stablecoinAdapter.address,
                    COLLATERAL_POOL_ID,
                    WeiPerWad,
                    WeiPerWad,
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                  ]
                )
                await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
                const alicePositionAddress = await positionManager.positions(1)
                const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
                const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
                expect(
                  alicePosition.lockedCollateral,
                  "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                  WeiPerWad
                )
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                  "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
                ).to.be.equal(0)
                expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(
                  WeiPerWad
                )
                // 2. Alice open a second new position with 2 ibDUMMY and draw 1 AUSD at new collateral pool
                const openPositionCall2 = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "openLockTokenAndDraw",
                  [
                    positionManager.address,
                    stabilityFeeCollector.address,
                    ibTokenAdapter2.address,
                    stablecoinAdapter.address,
                    COLLATERAL_POOL_ID2,
                    WeiPerWad.mul(2),
                    WeiPerWad,
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                  ]
                )
                await aliceProxyWallet["execute(address,bytes)"](
                  alpacaStablecoinProxyActions.address,
                  openPositionCall2
                )
                const alicePositionAddress2 = await positionManager.positions(2)
                const alpacaStablecoinBalance2 = await alpacaStablecoin.balanceOf(aliceAddress)
                const alicePosition2 = await bookKeeper.positions(COLLATERAL_POOL_ID2, alicePositionAddress2)
                expect(
                  alicePosition2.lockedCollateral,
                  "lockedCollateral should be 2 ibDUMMY, because Alice locked 2 ibDUMMY"
                ).to.be.equal(WeiPerWad.mul(2))
                expect(alicePosition2.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                  WeiPerWad
                )
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, alicePositionAddress2),
                  "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
                ).to.be.equal(0)
                expect(
                  alpacaStablecoinBalance2,
                  "Alice should receive 2 AUSD from drawing 1 AUSD 2 times form 2 positions"
                ).to.be.equal(WeiPerWad.mul(2))
                // 3. Alice try to unlock 1 ibDUMMY at second position
                const adjustPosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("adjustPosition", [
                  positionManager.address,
                  await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                  WeiPerWad.mul(-1),
                  0,
                  ibTokenAdapter2.address,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ])
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, adjustPosition)
                const aliceAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID2, alicePositionAddress2)
                expect(
                  aliceAdjustPosition.lockedCollateral,
                  "lockedCollateral should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(
                  aliceAdjustPosition.debtShare,
                  "debtShare should be 1 AUSD, because Alice didn't draw more"
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, alicePositionAddress2),
                  "collateralToken inside Alice's position address should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY into the position"
                ).to.be.equal(WeiPerWad)
                // 4. Alice try to move collateral from second position to first position
                const moveCollateral = alpacaStablecoinProxyActions.interface.encodeFunctionData("moveCollateral", [
                  positionManager.address,
                  await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                  alicePositionAddress,
                  WeiPerWad,
                  ibTokenAdapter2.address,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ])
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, moveCollateral)
                const aliceMoveCollateral = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
                const alpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
                expect(
                  aliceMoveCollateral.lockedCollateral,
                  "Alice's Position #1 lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(
                  aliceMoveCollateral.debtShare,
                  "Alice's Position #1 debtShare should be 1 AUSD, because Alice didn't draw more"
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                  "collateralToken from Collateral Pool #1 inside Alice's Position #1 address should be 0 ibDUMMY, because Alice can't move collateral from Position #2 to Position #1 as they are not from the same Collateral Pool."
                ).to.be.equal(0)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, alicePositionAddress2),
                  "collateralToken from Collateral Pool #2 inside Alice's position #2 address should be 0 ibDUMMY, because Alice moved 1 ibDUMMY into Collateral Pool #2 inside Alice's position #1"
                ).to.be.equal(0)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, alicePositionAddress),
                  "collateralToken from Collateral Pool #2 inside Alice's position #1 address should be 1 ibDUMMY, because Alice moved 1 ibDUMMY form Alice's position #2 to Collateral Pool #2 inside Alice's position #1"
                ).to.be.equal(WeiPerWad)
                expect(
                  alpacaStablecoinBalancefinal,
                  "Alice should receive 2 AUSD from drawing 2 AUSD, because Alice drew 2 times"
                ).to.be.equal(WeiPerWad.mul(2))
              })
            }
          )
          context(
            "Alice opens 2 positions on 2 collateral pools (one position for each collateral pool) and Alice move collateral from one position to another position",
            async () => {
              it("should success", async () => {
                // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
                const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "openLockTokenAndDraw",
                  [
                    positionManager.address,
                    stabilityFeeCollector.address,
                    ibTokenAdapter.address,
                    stablecoinAdapter.address,
                    COLLATERAL_POOL_ID,
                    WeiPerWad,
                    WeiPerWad,
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                  ]
                )
                await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
                const alicePositionAddress = await positionManager.positions(1)
                const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
                const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
                expect(
                  alicePosition.lockedCollateral,
                  "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                  WeiPerWad
                )
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                  "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
                ).to.be.equal(0)
                expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(
                  WeiPerWad
                )
                // 2. Alice open a second position at another collateral pool
                const openPositionCall2 = alpacaStablecoinProxyActions.interface.encodeFunctionData("open", [
                  positionManager.address,
                  COLLATERAL_POOL_ID2,
                  aliceProxyWallet.address,
                ])
                await aliceProxyWallet["execute(address,bytes)"](
                  alpacaStablecoinProxyActions.address,
                  openPositionCall2
                )
                const alicePositionAddress2 = await positionManager.positions(2)
                const alicePosition2 = await bookKeeper.positions(COLLATERAL_POOL_ID2, alicePositionAddress2)
                expect(
                  alicePosition2.lockedCollateral,
                  "lockedCollateral should be 0 ibDUMMY, because Alice doesn't locked ibDUMMY"
                ).to.be.equal(0)
                expect(alicePosition2.debtShare, "debtShare should be 0 AUSD, because doesn't drew AUSD").to.be.equal(0)
                // 3. Alice deposit 3 ibDUMMY to second position
                const depositPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "tokenAdapterDeposit",
                  [
                    ibTokenAdapter2.address,
                    await positionManager.positions(2),
                    WeiPerWad.mul(3),
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                  ]
                )
                await aliceProxyWallet["execute(address,bytes)"](
                  alpacaStablecoinProxyActions.address,
                  depositPositionCall
                )
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, alicePositionAddress2),
                  "collateralToken inside Alice's second position address should be 3 ibDUMMY, because Alice deposit 3 ibDUMMY into the second position"
                ).to.be.equal(WeiPerWad.mul(3))
                // 4. Alice try to move collateral from second position to first position
                const moveCollateral = alpacaStablecoinProxyActions.interface.encodeFunctionData("moveCollateral", [
                  positionManager.address,
                  await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                  alicePositionAddress,
                  WeiPerWad,
                  ibTokenAdapter2.address,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ])
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, moveCollateral)
                const aliceMoveCollateral = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
                const alpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
                expect(
                  aliceMoveCollateral.lockedCollateral,
                  "Alice's Position #1 lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(
                  aliceMoveCollateral.debtShare,
                  "Alice's Position #1 debtShare should be 1 AUSD, because Alice doesn't draw more"
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                  "collateralToken from Collateral Pool #1 inside Alice's Position #1 address should be 0 ibDUMMY, because Alice can't move collateral from Position #2 to Position #1 as they are not from the same Collateral Pool."
                ).to.be.equal(0)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, alicePositionAddress2),
                  "collateralToken from Collateral Pool #2 inside Alice's Position #2 address should be 2 ibDUMMY, because Alice move 1 ibDUMMY into Collateral Pool #2 inside Alice's position #1"
                ).to.be.equal(WeiPerWad.mul(2))
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, alicePositionAddress),
                  "collateralToken from Collateral Pool #2 inside Alice's Position #1 address should be 1 ibDUMMY, because Alice move 1 ibDUMMY form Alice's position #2 to Collateral Pool #2 inside Alice's position #1"
                ).to.be.equal(WeiPerWad)
                expect(
                  alpacaStablecoinBalancefinal,
                  "Alice should receive 1 AUSD, because Alice draw 1 time"
                ).to.be.equal(WeiPerWad)
              })
            }
          )
          context(
            "Alice open a position, lock collateral and move collateral to Bob's position at another collateral pool",
            async () => {
              it("should success", async () => {
                // 1. Alice open position
                const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("open", [
                  positionManager.address,
                  COLLATERAL_POOL_ID,
                  aliceProxyWallet.address,
                ])
                await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
                const alicePositionAddress = await positionManager.positions(1)
                const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
                expect(
                  alicePosition.lockedCollateral,
                  "Alice's Position #1 lockedCollateral should be 0 ibDUMMY, because Alice didn't locked ibDUMMY"
                ).to.be.equal(0)
                expect(
                  alicePosition.debtShare,
                  "Alice's Position #1 debtShare should be 0 AUSD, because didn't draw AUSD"
                ).to.be.equal(0)
                // 2. Alice deposit 3 ibDUMMY to her position
                const depositPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "tokenAdapterDeposit",
                  [
                    ibTokenAdapter.address,
                    await positionManager.positions(1),
                    WeiPerWad.mul(3),
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                  ]
                )
                await aliceProxyWallet["execute(address,bytes)"](
                  alpacaStablecoinProxyActions.address,
                  depositPositionCall
                )
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                  "collateralToken from Collateral Pool #1 inside Alice's Position #1 address should be 3 ibDUMMY, because Alice deposit 3 ibDUMMY into the her position"
                ).to.be.equal(WeiPerWad.mul(3))
                // 3. Bob open a position with 1 ibDUMMY and draw 1 AUSD at another collateral pool
                const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "openLockTokenAndDraw",
                  [
                    positionManager.address,
                    stabilityFeeCollector.address,
                    ibTokenAdapter2.address,
                    stablecoinAdapter.address,
                    COLLATERAL_POOL_ID2,
                    WeiPerWad,
                    WeiPerWad,
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
                  ]
                )
                await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
                await bobProxyWallet["execute(address,bytes)"](
                  alpacaStablecoinProxyActions.address,
                  bobOpenPositionCall
                )
                const bobPositionAddress = await positionManager.positions(2)
                const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
                const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID2, bobPositionAddress)
                expect(
                  bobPosition.lockedCollateral,
                  "lockedCollateral from Collateral Pool #2 inside Bob's Position #1 address should be 1 ibDUMMY, because Bob locked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(
                  bobPosition.debtShare,
                  "debtShare from Collateral Pool #2 inside Bob's Position #1 address should be 1 AUSD, because Bob drew 1 AUSD"
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, bobPositionAddress),
                  "collateralToken from Collateral Pool #2 inside Bob's Position #1 address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
                ).to.be.equal(0)
                expect(alpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
                // 4. Alice try to move collateral to Bob's position across collateral pool
                const moveCollateral = alpacaStablecoinProxyActions.interface.encodeFunctionData("moveCollateral", [
                  positionManager.address,
                  await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                  bobPositionAddress,
                  WeiPerWad,
                  ibTokenAdapter.address,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ])
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, moveCollateral)
                const aliceAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
                const bobAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(bobAddress)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                  "collateralToken from Collateral Pool #1 inside Alice's Position #1 address should be 2 ibDUMMY, because Alice move 1 ibDUMMY to Bob's position"
                ).to.be.equal(WeiPerWad.mul(2))
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
                  "collateralToken from Collateral Pool #1 inside new Bob's Position address should be 1 ibDUMMY, because System auto create Bob's position at Collateral Pool #1, so Alice can move 1 ibDUMMY into the new Bob's position"
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, bobPositionAddress),
                  "collateralToken from Collateral Pool #2 inside Bob's Position #1 address should be 0 ibDUMMY, because Alice can't move ibDUMMY across collateral pool"
                ).to.be.equal(0)
                expect(
                  aliceAlpacaStablecoinBalancefinal,
                  "Alice should receive 0 AUSD, because Alice didn't draw more"
                ).to.be.equal(0)
                expect(
                  bobAlpacaStablecoinBalancefinal,
                  "Bob should receive 1 AUSD, because Bob drew 1 time"
                ).to.be.equal(WeiPerWad)
              })
            }
          )
        })
      })

      context("mint AUSD", async () => {
        it("should success", async () => {
          // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            COLLATERAL_POOL_ID,
            WeiPerWad.mul(2),
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
            "lockedCollateral should be 2 ibDUMMY, because Alice locked 2 ibDUMMY"
          ).to.be.equal(WeiPerWad.mul(2))
          expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
            WeiPerWad
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)

          // 2. Alice try to mint AUSD
          const drawAUSD = alpacaStablecoinProxyActions.interface.encodeFunctionData("draw", [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            await positionManager.ownerLastPositionId(aliceProxyWallet.address),
            WeiPerWad,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, drawAUSD)
          const alpacaStablecoinBalance2 = await alpacaStablecoin.balanceOf(aliceAddress)
          const aliceAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          expect(
            aliceAdjustPosition.lockedCollateral,
            "lockedCollateral should be 2 ibDUMMY, because Alice doesn't add ibDUMMY"
          ).to.be.equal(WeiPerWad.mul(2))
          expect(aliceAdjustPosition.debtShare, "debtShare should be 2 AUSD, because Alice drew more").to.be.equal(
            WeiPerWad.mul(2)
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance2, "Alice should receive 2 AUSD from drawing 2 AUSD").to.be.equal(
            WeiPerWad.mul(2)
          )
        })
      })

      context("move position", async () => {
        context("same collateral pool", async () => {
          context(
            "call openLockTokenAndDraw, unlock collateral and move the collateral from one position to another position within the same collateral pool",
            async () => {
              it("should success", async () => {
                // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
                const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "openLockTokenAndDraw",
                  [
                    positionManager.address,
                    stabilityFeeCollector.address,
                    ibTokenAdapter.address,
                    stablecoinAdapter.address,
                    COLLATERAL_POOL_ID,
                    WeiPerWad,
                    WeiPerWad,
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                  ]
                )
                await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
                const alicePositionAddress = await positionManager.positions(1)
                const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
                const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

                expect(
                  alicePosition.lockedCollateral,
                  "Alice's Position #1 lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                  WeiPerWad
                )
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                  "Alice's Position #1 collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
                ).to.be.equal(0)
                expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(
                  WeiPerWad
                )

                // 2. Alice open a second new position with 2 ibDUMMY and draw 1 AUSD at same collateral pool
                const openPositionCall2 = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "openLockTokenAndDraw",
                  [
                    positionManager.address,
                    stabilityFeeCollector.address,
                    ibTokenAdapter.address,
                    stablecoinAdapter.address,
                    COLLATERAL_POOL_ID,
                    WeiPerWad.mul(2),
                    WeiPerWad,
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                  ]
                )
                await aliceProxyWallet["execute(address,bytes)"](
                  alpacaStablecoinProxyActions.address,
                  openPositionCall2
                )
                const alicePositionAddress2 = await positionManager.positions(2)
                const alpacaStablecoinBalance2 = await alpacaStablecoin.balanceOf(aliceAddress)
                const alicePosition2 = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress2)

                expect(
                  alicePosition2.lockedCollateral,
                  "Alice's Position #2 lockedCollateral should be 2 ibDUMMY, because Alice locked 2 ibDUMMY"
                ).to.be.equal(WeiPerWad.mul(2))
                expect(alicePosition2.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                  WeiPerWad
                )
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress2),
                  "Alice's Position #2 collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
                ).to.be.equal(0)
                expect(
                  alpacaStablecoinBalance2,
                  "Alice should receive 2 AUSD, because Alice drew AUSD 2 times form 2 positions"
                ).to.be.equal(WeiPerWad.mul(2))

                // 3. Alice try to unlock 1 ibDUMMY at second position
                const adjustPosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("adjustPosition", [
                  positionManager.address,
                  await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                  WeiPerWad.mul(-1),
                  0,
                  ibTokenAdapter.address,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ])
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, adjustPosition)
                const aliceAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress2)
                expect(
                  aliceAdjustPosition.lockedCollateral,
                  "Alice's Position #2 lockedCollateral should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(
                  aliceAdjustPosition.debtShare,
                  "Alice's Position #2 debtShare should be 1 AUSD, because Alice didn't draw more"
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress2),
                  "Alice's Position #2 collateralToken should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY into the position"
                ).to.be.equal(WeiPerWad)

                // 4. Alice try to move position from second position to first position
                const movePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("movePosition", [
                  positionManager.address,
                  2,
                  1,
                ])
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, movePosition)
                const alicemovePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
                const alpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
                expect(
                  alicemovePosition.lockedCollateral,
                  "Alice's Position #1 lockedCollateral should be 2 ibDUMMY, because Alice move form Position #2 to Postion #1"
                ).to.be.equal(WeiPerWad.mul(2))
                expect(
                  alicemovePosition.debtShare,
                  "Alice's Position #1 debtShare should be 2 AUSD, because Alice move form Position #2 to Postion #1"
                ).to.be.equal(WeiPerWad.mul(2))
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress2),
                  "collateralToken inside Alice's Position #2 address should still be 1 ibDUMMY, because Alice moving position will not move collateral"
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                  "collateralToken inside Alice's Position #1 address should still be 0 ibDUMMY, because Alice moving position will not move collateral"
                ).to.be.equal(0)
                expect(
                  alpacaStablecoinBalancefinal,
                  "Alice should receive 2 AUSD from drawing 2 AUSD, because Alice drew 2 times"
                ).to.be.equal(WeiPerWad.mul(2))
              })
            }
          )
        })

        context("between 2 collateral pool", async () => {
          context(
            "Alice opens 2 positions on 2 collateral pools (one position for each collateral pool) and Alice move collateral from one position to another position",
            async () => {
              it("should revert", async () => {
                // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
                const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "openLockTokenAndDraw",
                  [
                    positionManager.address,
                    stabilityFeeCollector.address,
                    ibTokenAdapter.address,
                    stablecoinAdapter.address,
                    COLLATERAL_POOL_ID,
                    WeiPerWad,
                    WeiPerWad,
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                  ]
                )
                await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
                const alicePositionAddress = await positionManager.positions(1)
                const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
                const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

                expect(
                  alicePosition.lockedCollateral,
                  "Collateral Pool #1 inside Bob's Position #1 lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(
                  alicePosition.debtShare,
                  "Collateral Pool #1 inside Bob's Position #1 debtShare should be 1 AUSD, because Alice drew 1 AUSD"
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                  "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
                ).to.be.equal(0)
                expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(
                  WeiPerWad
                )

                // 2. Alice open a second new position with 2 ibDUMMY and draw 1 AUSD at new collateral pool
                const openPositionCall2 = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                  "openLockTokenAndDraw",
                  [
                    positionManager.address,
                    stabilityFeeCollector.address,
                    ibTokenAdapter2.address,
                    stablecoinAdapter.address,
                    COLLATERAL_POOL_ID2,
                    WeiPerWad.mul(2),
                    WeiPerWad,
                    true,
                    ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                  ]
                )
                await aliceProxyWallet["execute(address,bytes)"](
                  alpacaStablecoinProxyActions.address,
                  openPositionCall2
                )
                const alicePositionAddress2 = await positionManager.positions(2)
                const alpacaStablecoinBalance2 = await alpacaStablecoin.balanceOf(aliceAddress)
                const alicePosition2 = await bookKeeper.positions(COLLATERAL_POOL_ID2, alicePositionAddress2)

                expect(
                  alicePosition2.lockedCollateral,
                  "Collateral Pool #2 inside Bob's Position #2 lockedCollateral should be 2 ibDUMMY, because Alice locked 2 ibDUMMY"
                ).to.be.equal(WeiPerWad.mul(2))
                expect(
                  alicePosition2.debtShare,
                  "Collateral Pool #2 inside Bob's Position #2 debtShare should be 1 AUSD, because Alice drew 1 AUSD"
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, alicePositionAddress2),
                  "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
                ).to.be.equal(0)
                expect(
                  alpacaStablecoinBalance2,
                  "Alice should receive 2 AUSD from drawing 1 AUSD 2 times form 2 positions"
                ).to.be.equal(WeiPerWad.mul(2))

                // 3. Alice try to unlock 1 ibDUMMY at second position
                const adjustPosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("adjustPosition", [
                  positionManager.address,
                  await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                  WeiPerWad.mul(-1),
                  0,
                  ibTokenAdapter2.address,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ])
                await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, adjustPosition)
                const aliceAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID2, alicePositionAddress2)
                expect(
                  aliceAdjustPosition.lockedCollateral,
                  "Collateral Pool #2 inside Bob's Position #2 lockedCollateral should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY"
                ).to.be.equal(WeiPerWad)
                expect(
                  aliceAdjustPosition.debtShare,
                  "Collateral Pool #2 inside Bob's Position #2 debtShare should be 1 AUSD, because Alice didn't draw more"
                ).to.be.equal(WeiPerWad)
                expect(
                  await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, alicePositionAddress2),
                  "collateralToken inside Alice's position address should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY into the position"
                ).to.be.equal(WeiPerWad)

                // 4. Alice try to move collateral from second position to first position
                const movePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("movePosition", [
                  positionManager.address,
                  2,
                  1,
                ])
                await expect(
                  aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, movePosition)
                ).to.be.revertedWith("!same collateral pool")
              })
            }
          )
        })
      })
    })

    context("owner position allow other user to manage position with proxy wallet", async () => {
      context("lock collateral into their own position", async () => {
        it("should success", async () => {
          // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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
          expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
            WeiPerWad
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
          // 2. Alice allow Bob to manage position
          const allowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("allowManagePosition", [
            positionManager.address,
            1,
            bobProxyWallet.address,
            1,
          ])
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, allowManagePosition)
          expect(await positionManager.ownerWhitelist(aliceProxyWallet.address, 1, bobProxyWallet.address)).to.be.equal(
            1
          )
          // 3. Bob try to adjust Alice's position, add 2 ibDummy to position
          const lockToken = alpacaStablecoinProxyActions.interface.encodeFunctionData("lockToken", [
            positionManager.address,
            ibTokenAdapter.address,
            await positionManager.ownerLastPositionId(aliceProxyWallet.address),
            WeiPerWad.mul(2),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
          await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, lockToken)
          const aliceAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          expect(
            aliceAdjustPosition.lockedCollateral,
            "lockedCollateral should be 3 ibDUMMY, because Bob add locked 2 ibDUMMY"
          ).to.be.equal(WeiPerWad.mul(3))
        })
      })
      context("move collateral", async () => {
        context("same collateral pool", async () => {
          context("and Bob move collateral of Alice to himself", async () => {
            it("should success", async () => {
              // 1. Alice open a new position with 2 ibDUMMY and draw 1 AUSD
              const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "openLockTokenAndDraw",
                [
                  positionManager.address,
                  stabilityFeeCollector.address,
                  ibTokenAdapter.address,
                  stablecoinAdapter.address,
                  COLLATERAL_POOL_ID,
                  WeiPerWad.mul(2),
                  WeiPerWad,
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ]
              )
              await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
              await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
              const alicePositionAddress = await positionManager.positions(1)
              const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
              const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
              expect(
                alicePosition.lockedCollateral,
                "lockedCollateral should be 2 ibDUMMY, because Alice locked 2 ibDUMMY"
              ).to.be.equal(WeiPerWad.mul(2))
              expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                WeiPerWad
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
              ).to.be.equal(0)
              expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
              // 2. Bob open a position with 1 ibDUMMY and draw 1 AUSD
              const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "openLockTokenAndDraw",
                [
                  positionManager.address,
                  stabilityFeeCollector.address,
                  ibTokenAdapter.address,
                  stablecoinAdapter.address,
                  COLLATERAL_POOL_ID,
                  WeiPerWad,
                  WeiPerWad,
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
                ]
              )
              await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
              await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobOpenPositionCall)
              const bobPositionAddress = await positionManager.positions(2)
              const bobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
              const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, bobPositionAddress)
              expect(
                bobPosition.lockedCollateral,
                "lockedCollateral should be 1 ibDUMMY, because Bob locked 1 ibDUMMY"
              ).to.be.equal(WeiPerWad)
              expect(bobPosition.debtShare, "debtShare should be 1 AUSD, because Bob drew 1 AUSD").to.be.equal(
                WeiPerWad
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
                "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
              ).to.be.equal(0)
              expect(bobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
              // 3. Alice try to unlock 1 ibDUMMY at her position
              const adjustPosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("adjustPosition", [
                positionManager.address,
                await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                WeiPerWad.mul(-1),
                0,
                ibTokenAdapter.address,
                ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
              ])
              await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, adjustPosition)
              const aliceAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
              expect(
                aliceAdjustPosition.lockedCollateral,
                "lockedCollateral should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY"
              ).to.be.equal(WeiPerWad)
              expect(
                aliceAdjustPosition.debtShare,
                "debtShare should be 1 AUSD, because Alice doesn't draw more"
              ).to.be.equal(WeiPerWad)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY into the position"
              ).to.be.equal(WeiPerWad)
              // 4. Alice allow Bob to manage position
              const allowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "allowManagePosition",
                [positionManager.address, 1, bobProxyWallet.address, 1]
              )
              await aliceProxyWallet["execute(address,bytes)"](
                alpacaStablecoinProxyActions.address,
                allowManagePosition
              )
              expect(
                await positionManager.ownerWhitelist(aliceProxyWallet.address, 1, bobProxyWallet.address)
              ).to.be.equal(1)
              // 5. Bob try to move collateral to Alice position
              const moveCollateral = alpacaStablecoinProxyActions.interface.encodeFunctionData("moveCollateral", [
                positionManager.address,
                await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                bobPositionAddress,
                WeiPerWad,
                ibTokenAdapter.address,
                ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
              ])
              await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, moveCollateral)
              const aliceAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
              const bobAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(bobAddress)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 0 ibDUMMY, because Bob move 1 ibDUMMY of Alice's position to his position"
              ).to.be.equal(0)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
                "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob move 1 ibDUMMY of Alice's position to his position"
              ).to.be.equal(WeiPerWad)
              expect(
                aliceAlpacaStablecoinBalancefinal,
                "Alice should receive 1 AUSD, because Alice drew 1 time"
              ).to.be.equal(WeiPerWad)
              expect(bobAlpacaStablecoinBalancefinal, "Bob should receive 1 AUSD, because Bob drew 1 time").to.be.equal(
                WeiPerWad
              )
            })
          })
        })
        context("between collateral pool", async () => {
          context("and Bob move collateral of Alice to himself", async () => {
            it("should success", async () => {
              // 1. Alice open a new position with 2 ibDUMMY and draw 1 AUSD
              const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "openLockTokenAndDraw",
                [
                  positionManager.address,
                  stabilityFeeCollector.address,
                  ibTokenAdapter.address,
                  stablecoinAdapter.address,
                  COLLATERAL_POOL_ID,
                  WeiPerWad.mul(2),
                  WeiPerWad,
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ]
              )
              await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
              await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
              const alicePositionAddress = await positionManager.positions(1)
              const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
              const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
              expect(
                alicePosition.lockedCollateral,
                "lockedCollateral should be 2 ibDUMMY, because Alice locked 2 ibDUMMY"
              ).to.be.equal(WeiPerWad.mul(2))
              expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                WeiPerWad
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
              ).to.be.equal(0)
              expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
              // 2. Bob open a position at collateral pool 2 with 1 ibDUMMY and draw 1 AUSD
              const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "openLockTokenAndDraw",
                [
                  positionManager.address,
                  stabilityFeeCollector.address,
                  ibTokenAdapter2.address,
                  stablecoinAdapter.address,
                  COLLATERAL_POOL_ID2,
                  WeiPerWad,
                  WeiPerWad,
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
                ]
              )
              await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
              await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobOpenPositionCall)
              const bobPositionAddress = await positionManager.positions(2)
              const bobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
              const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID2, bobPositionAddress)
              expect(
                bobPosition.lockedCollateral,
                "lockedCollateral should be 1 ibDUMMY, because Bob locked 1 ibDUMMY"
              ).to.be.equal(WeiPerWad)
              expect(bobPosition.debtShare, "debtShare should be 1 AUSD, because Bob drew 1 AUSD").to.be.equal(
                WeiPerWad
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, bobPositionAddress),
                "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
              ).to.be.equal(0)
              expect(bobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
              // 3. Alice try to unlock 1 ibDUMMY at her position
              const adjustPosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("adjustPosition", [
                positionManager.address,
                await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                WeiPerWad.mul(-1),
                0,
                ibTokenAdapter.address,
                ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
              ])
              await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, adjustPosition)
              const aliceAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
              expect(
                aliceAdjustPosition.lockedCollateral,
                "lockedCollateral should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY"
              ).to.be.equal(WeiPerWad)
              expect(
                aliceAdjustPosition.debtShare,
                "debtShare should be 1 AUSD, because Alice didn't draw more"
              ).to.be.equal(WeiPerWad)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY at her position"
              ).to.be.equal(WeiPerWad)
              // 4. Alice allow Bob to manage position
              const allowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "allowManagePosition",
                [positionManager.address, 1, bobProxyWallet.address, 1]
              )
              await aliceProxyWallet["execute(address,bytes)"](
                alpacaStablecoinProxyActions.address,
                allowManagePosition
              )
              expect(
                await positionManager.ownerWhitelist(aliceProxyWallet.address, 1, bobProxyWallet.address)
              ).to.be.equal(1)
              // 5. Bob try to move collateral to Alice position
              const moveCollateral = alpacaStablecoinProxyActions.interface.encodeFunctionData("moveCollateral", [
                positionManager.address,
                await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                bobPositionAddress,
                WeiPerWad,
                ibTokenAdapter.address,
                ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
              ])
              await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, moveCollateral)
              const aliceAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
              const bobAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(bobAddress)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 0 ibDUMMY, because Bob move 1 ibDUMMY of Alice's position to himself"
              ).to.be.equal(0)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
                "collateralToken inside Bob's position address should be 1 ibDUMMY, because Bob move 1 ibDUMMY of Alice's position to himself"
              ).to.be.equal(WeiPerWad)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, bobPositionAddress),
                "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob move 1 ibDUMMY of Alice's position to himself"
              ).to.be.equal(0)
              expect(
                aliceAlpacaStablecoinBalancefinal,
                "Alice should receive 1 AUSD, because Alice drew 1 time"
              ).to.be.equal(WeiPerWad)
              expect(bobAlpacaStablecoinBalancefinal, "Bob should receive 1 AUSD, because Bob drew 1 time").to.be.equal(
                WeiPerWad
              )
            })
          })
        })
      })
      context("mint AUSD", async () => {
        it("should success", async () => {
          // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            COLLATERAL_POOL_ID,
            WeiPerWad.mul(2),
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
            "lockedCollateral should be 2 ibDUMMY, because Alice locked 2 ibDUMMY"
          ).to.be.equal(WeiPerWad.mul(2))
          expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
            WeiPerWad
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
          // 2. Alice allow Bob to manage position
          const allowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("allowManagePosition", [
            positionManager.address,
            1,
            bobProxyWallet.address,
            1,
          ])
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, allowManagePosition)
          expect(await positionManager.ownerWhitelist(aliceProxyWallet.address, 1, bobProxyWallet.address)).to.be.equal(
            1
          )
          // 3. Bob try to mint AUSD at Alice position
          const drawAUSD = alpacaStablecoinProxyActions.interface.encodeFunctionData("draw", [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            await positionManager.ownerLastPositionId(aliceProxyWallet.address),
            WeiPerWad,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, drawAUSD)
          const alpacaStablecoinBalance2 = await alpacaStablecoin.balanceOf(aliceAddress)
          const BobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
          const aliceAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          expect(
            aliceAdjustPosition.lockedCollateral,
            "lockedCollateral should be 2 ibDUMMY, because Alice didn't add ibDUMMY"
          ).to.be.equal(WeiPerWad.mul(2))
          expect(aliceAdjustPosition.debtShare, "debtShare should be 2 AUSD, because Alice drew more").to.be.equal(
            WeiPerWad.mul(2)
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance2, "Alice should receive 1 AUSD from Alice drew 1 time").to.be.equal(WeiPerWad)
          expect(BobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from Alice position").to.be.equal(WeiPerWad)
        })
      })
      context("move position", async () => {
        context("same collateral pool", async () => {
          it("should success", async () => {
            // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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
            expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
              WeiPerWad
            )
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
              "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
            ).to.be.equal(0)
            expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
            // 2. Bob open a position with 1 ibDUMMY and draw 1 AUSD
            const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
              "openLockTokenAndDraw",
              [
                positionManager.address,
                stabilityFeeCollector.address,
                ibTokenAdapter.address,
                stablecoinAdapter.address,
                COLLATERAL_POOL_ID,
                WeiPerWad,
                WeiPerWad,
                true,
                ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
              ]
            )
            await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
            await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobOpenPositionCall)
            const bobPositionAddress = await positionManager.positions(2)
            const bobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
            const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, bobPositionAddress)
            expect(
              bobPosition.lockedCollateral,
              "lockedCollateral should be 1 ibDUMMY, because Bob locked 1 ibDUMMY"
            ).to.be.equal(WeiPerWad)
            expect(bobPosition.debtShare, "debtShare should be 1 AUSD, because Bob drew 1 AUSD").to.be.equal(WeiPerWad)
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
              "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
            ).to.be.equal(0)
            expect(bobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
            // 3. Alice allow Bob to manage position
            const allowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData(
              "allowManagePosition",
              [positionManager.address, 1, bobProxyWallet.address, 1]
            )
            await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, allowManagePosition)
            expect(
              await positionManager.ownerWhitelist(aliceProxyWallet.address, 1, bobProxyWallet.address)
            ).to.be.equal(1)
            // 4. Bob try to move collateral to alice position
            const movePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("movePosition", [
              positionManager.address,
              2,
              1,
            ])
            await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, movePosition)
            const aliceAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
            const bobAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(bobAddress)
            const alicePositionAfterMovePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
            expect(
              alicePositionAfterMovePosition.lockedCollateral,
              "lockedCollateral should be 2 ibDUMMY, because Bob move locked 1 ibDUMMY to Alice"
            ).to.be.equal(WeiPerWad.mul(2))
            expect(
              alicePositionAfterMovePosition.debtShare,
              "debtShare should be 1 AUSD, because Bob move DebtShare to Alice"
            ).to.be.equal(WeiPerWad.mul(2))
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
              "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice all lock collateral"
            ).to.be.equal(0)
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
              "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob all lock collateral"
            ).to.be.equal(0)
            expect(
              aliceAlpacaStablecoinBalancefinal,
              "Alice should receive 1 AUSD, because Alice drew 1 time"
            ).to.be.equal(WeiPerWad)
            expect(bobAlpacaStablecoinBalancefinal, "Bob should receive 1 AUSD, because Bob drew 1 time").to.be.equal(
              WeiPerWad
            )
          })
        })
        context("between 2 collateral pool", async () => {
          it("should revert", async () => {
            // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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
            expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
              WeiPerWad
            )
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
              "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
            ).to.be.equal(0)
            expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
            // 2. Bob open a position with 1 ibDUMMY and draw 1 AUSD at collateral pool id 2
            const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
              "openLockTokenAndDraw",
              [
                positionManager.address,
                stabilityFeeCollector.address,
                ibTokenAdapter2.address,
                stablecoinAdapter.address,
                COLLATERAL_POOL_ID2,
                WeiPerWad,
                WeiPerWad,
                true,
                ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
              ]
            )
            await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
            await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobOpenPositionCall)
            const bobPositionAddress = await positionManager.positions(2)
            const bobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
            const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID2, bobPositionAddress)
            expect(
              bobPosition.lockedCollateral,
              "lockedCollateral should be 1 ibDUMMY, because Bob locked 1 ibDUMMY"
            ).to.be.equal(WeiPerWad)
            expect(bobPosition.debtShare, "debtShare should be 1 AUSD, because Bob drew 1 AUSD").to.be.equal(WeiPerWad)
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, bobPositionAddress),
              "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
            ).to.be.equal(0)
            expect(bobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
            // 3. Alice allow Bob to manage position
            const allowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData(
              "allowManagePosition",
              [positionManager.address, 1, bobProxyWallet.address, 1]
            )
            await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, allowManagePosition)
            expect(
              await positionManager.ownerWhitelist(aliceProxyWallet.address, 1, bobProxyWallet.address)
            ).to.be.equal(1)
            // 4. Bob try to move position to Alice position
            const movePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("movePosition", [
              positionManager.address,
              2,
              1,
            ])
            await expect(
              bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, movePosition)
            ).to.be.revertedWith("!same collateral pool")
          })
        })
      })
    })

    context("owner position not allow other user to manage position with proxy wallet", async () => {
      context("lock collateral", async () => {
        it("should revert", async () => {
          // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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
          expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
            WeiPerWad
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)

          // 2. Bob try to adjust Alice's position, add 2 ibDummy to position
          const lockToken = alpacaStablecoinProxyActions.interface.encodeFunctionData("lockToken", [
            positionManager.address,
            ibTokenAdapter.address,
            await positionManager.ownerLastPositionId(aliceProxyWallet.address),
            WeiPerWad.mul(2),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
          await expect(
            bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, lockToken)
          ).to.be.revertedWith("owner not allowed")
        })
      })
      context("move collateral", async () => {
        context("same collateral pool", async () => {
          context("and Bob move collateral to Alice", async () => {
            it("should success", async () => {
              // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
              const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "openLockTokenAndDraw",
                [
                  positionManager.address,
                  stabilityFeeCollector.address,
                  ibTokenAdapter.address,
                  stablecoinAdapter.address,
                  COLLATERAL_POOL_ID,
                  WeiPerWad,
                  WeiPerWad,
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ]
              )
              await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
              await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
              const alicePositionAddress = await positionManager.positions(1)
              const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
              const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
              expect(
                alicePosition.lockedCollateral,
                "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
              ).to.be.equal(WeiPerWad)
              expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                WeiPerWad
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
              ).to.be.equal(0)
              expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
              // 2. Bob open a position with 2 ibDUMMY and draw 1 AUSD
              const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "openLockTokenAndDraw",
                [
                  positionManager.address,
                  stabilityFeeCollector.address,
                  ibTokenAdapter.address,
                  stablecoinAdapter.address,
                  COLLATERAL_POOL_ID,
                  WeiPerWad.mul(2),
                  WeiPerWad,
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
                ]
              )
              await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
              await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobOpenPositionCall)
              const bobPositionAddress = await positionManager.positions(2)
              const bobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
              const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, bobPositionAddress)
              expect(
                bobPosition.lockedCollateral,
                "lockedCollateral should be 2 ibDUMMY, because Bob locked 2 ibDUMMY"
              ).to.be.equal(WeiPerWad.mul(2))
              expect(bobPosition.debtShare, "debtShare should be 1 AUSD, because Bob drew 1 AUSD").to.be.equal(
                WeiPerWad
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
                "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
              ).to.be.equal(0)
              expect(bobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
              // 3. Bob try to unlock 1 ibDUMMY at second position
              const adjustPosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("adjustPosition", [
                positionManager.address,
                await positionManager.ownerLastPositionId(bobProxyWallet.address),
                WeiPerWad.mul(-1),
                0,
                ibTokenAdapter.address,
                ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
              ])
              await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, adjustPosition)
              const bobAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, bobPositionAddress)
              expect(
                bobAdjustPosition.lockedCollateral,
                "lockedCollateral should be 1 ibDUMMY, because Bob unlocked 1 ibDUMMY"
              ).to.be.equal(WeiPerWad)
              expect(
                bobAdjustPosition.debtShare,
                "debtShare should be 1 AUSD, because Bob doesn't draw more"
              ).to.be.equal(WeiPerWad)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
                "collateralToken inside Bob's position address should be 1 ibDUMMY, because Bob unlocked 1 ibDUMMY into the position"
              ).to.be.equal(WeiPerWad)
              // 4. Bob try to move collateral to Alice position
              const moveCollateral = alpacaStablecoinProxyActions.interface.encodeFunctionData("moveCollateral", [
                positionManager.address,
                await positionManager.ownerLastPositionId(bobProxyWallet.address),
                alicePositionAddress,
                WeiPerWad,
                ibTokenAdapter.address,
                ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
              ])
              await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, moveCollateral)
              const aliceAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
              const bobAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(bobAddress)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 1 ibDUMMY, because Bob move 1 ibDUMMY to Alice's position"
              ).to.be.equal(WeiPerWad)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
                "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob move 1 ibDUMMY to Alice's position"
              ).to.be.equal(0)
              expect(
                aliceAlpacaStablecoinBalancefinal,
                "Alice should receive 1 AUSD, because Alice drew 1 time"
              ).to.be.equal(WeiPerWad)
              expect(bobAlpacaStablecoinBalancefinal, "Bob should receive 1 AUSD, because Bob drew 1 time").to.be.equal(
                WeiPerWad
              )
            })
          })
        })
        context("between collateral pool", async () => {
          context("and Bob move collateral to Alice", async () => {
            it("should success", async () => {
              // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
              const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "openLockTokenAndDraw",
                [
                  positionManager.address,
                  stabilityFeeCollector.address,
                  ibTokenAdapter.address,
                  stablecoinAdapter.address,
                  COLLATERAL_POOL_ID,
                  WeiPerWad,
                  WeiPerWad,
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ]
              )
              await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
              await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
              const alicePositionAddress = await positionManager.positions(1)
              const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
              const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
              expect(
                alicePosition.lockedCollateral,
                "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
              ).to.be.equal(WeiPerWad)
              expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                WeiPerWad
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
              ).to.be.equal(0)
              expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
              // 2. Bob open a position at collateral pool 2 with 2 ibDUMMY and draw 1 AUSD
              const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "openLockTokenAndDraw",
                [
                  positionManager.address,
                  stabilityFeeCollector.address,
                  ibTokenAdapter2.address,
                  stablecoinAdapter.address,
                  COLLATERAL_POOL_ID2,
                  WeiPerWad.mul(2),
                  WeiPerWad,
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
                ]
              )
              await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
              await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobOpenPositionCall)
              const bobPositionAddress = await positionManager.positions(2)
              const bobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
              const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID2, bobPositionAddress)
              expect(
                bobPosition.lockedCollateral,
                "lockedCollateral should be 2 ibDUMMY, because Bob locked 2 ibDUMMY"
              ).to.be.equal(WeiPerWad.mul(2))
              expect(bobPosition.debtShare, "debtShare should be 1 AUSD, because Bob drew 1 AUSD").to.be.equal(
                WeiPerWad
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, bobPositionAddress),
                "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
              ).to.be.equal(0)
              expect(bobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
              // 3. Bob try to unlock 1 ibDUMMY at second position
              const adjustPosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("adjustPosition", [
                positionManager.address,
                await positionManager.ownerLastPositionId(bobProxyWallet.address),
                WeiPerWad.mul(-1),
                0,
                ibTokenAdapter2.address,
                ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
              ])
              await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, adjustPosition)
              const bobAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID2, bobPositionAddress)
              expect(
                bobAdjustPosition.lockedCollateral,
                "lockedCollateral should be 1 ibDUMMY, because Bob unlocked 1 ibDUMMY"
              ).to.be.equal(WeiPerWad)
              expect(
                bobAdjustPosition.debtShare,
                "debtShare should be 1 AUSD, because Bob didn't draw more"
              ).to.be.equal(WeiPerWad)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, bobPositionAddress),
                "collateralToken inside Bob's position address should be 1 ibDUMMY, because Bob unlocked 1 ibDUMMY into the position"
              ).to.be.equal(WeiPerWad)
              // 4. Bob try to move collateral to Alice position
              const moveCollateral = alpacaStablecoinProxyActions.interface.encodeFunctionData("moveCollateral", [
                positionManager.address,
                await positionManager.ownerLastPositionId(bobProxyWallet.address),
                alicePositionAddress,
                WeiPerWad,
                ibTokenAdapter2.address,
                ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
              ])
              await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, moveCollateral)
              const aliceAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
              const bobAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(bobAddress)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 0 ibDUMMY, because Bob move 1 ibDUMMY to Alice's position"
              ).to.be.equal(0)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, alicePositionAddress),
                "collateralToken inside Alice's position address should be 1 ibDUMMY, because Bob move 1 ibDUMMY to Alice's position"
              ).to.be.equal(WeiPerWad)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
                "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob move 1 ibDUMMY to Alice's position"
              ).to.be.equal(0)
              expect(
                aliceAlpacaStablecoinBalancefinal,
                "Alice should receive 1 AUSD, because Alice drew 1 time"
              ).to.be.equal(WeiPerWad)
              expect(bobAlpacaStablecoinBalancefinal, "Bob should receive 1 AUSD, because Bob drew 1 time").to.be.equal(
                WeiPerWad
              )
            })
          })
        })
      })
      context("mint AUSD", async () => {
        it("should revert", async () => {
          // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            COLLATERAL_POOL_ID,
            WeiPerWad.mul(2),
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
            "lockedCollateral should be 2 ibDUMMY, because Alice locked 2 ibDUMMY"
          ).to.be.equal(WeiPerWad.mul(2))
          expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
            WeiPerWad
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
          // 2. Bob try to mint AUSD at Alice position
          const drawAUSD = alpacaStablecoinProxyActions.interface.encodeFunctionData("draw", [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            await positionManager.ownerLastPositionId(aliceProxyWallet.address),
            WeiPerWad,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await expect(
            bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, drawAUSD)
          ).to.be.revertedWith("owner not allowed")
        })
      })
      context("move position", async () => {
        context("same collateral pool", async () => {
          it("should revert", async () => {
            // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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
            expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
              WeiPerWad
            )
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
              "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
            ).to.be.equal(0)
            expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
            // 2. Bob open a position with 1 ibDUMMY and draw 1 AUSD
            const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
              "openLockTokenAndDraw",
              [
                positionManager.address,
                stabilityFeeCollector.address,
                ibTokenAdapter.address,
                stablecoinAdapter.address,
                COLLATERAL_POOL_ID,
                WeiPerWad,
                WeiPerWad,
                true,
                ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
              ]
            )
            await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
            await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobOpenPositionCall)
            const bobPositionAddress = await positionManager.positions(2)
            const bobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
            const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, bobPositionAddress)
            expect(
              bobPosition.lockedCollateral,
              "lockedCollateral should be 1 ibDUMMY, because Bob locked 1 ibDUMMY"
            ).to.be.equal(WeiPerWad)
            expect(bobPosition.debtShare, "debtShare should be 1 AUSD, because Bob drew 1 AUSD").to.be.equal(WeiPerWad)
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
              "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
            ).to.be.equal(0)
            expect(bobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
            // 3. Bob try to move collateral to alice position
            const movePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("movePosition", [
              positionManager.address,
              2,
              1,
            ])
            await expect(
              bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, movePosition)
            ).to.be.revertedWith("owner not allowed")
          })
        })
        context("between 2 collateral pool", async () => {
          it("should revert", async () => {
            // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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
            expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
              WeiPerWad
            )
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
              "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
            ).to.be.equal(0)
            expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)

            // 2. Bob open a position with 1 ibDUMMY and draw 1 AUSD at collateral pool id 2
            const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
              "openLockTokenAndDraw",
              [
                positionManager.address,
                stabilityFeeCollector.address,
                ibTokenAdapter2.address,
                stablecoinAdapter.address,
                COLLATERAL_POOL_ID2,
                WeiPerWad,
                WeiPerWad,
                true,
                ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
              ]
            )
            await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
            await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobOpenPositionCall)
            const bobPositionAddress = await positionManager.positions(2)
            const bobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
            const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID2, bobPositionAddress)
            expect(
              bobPosition.lockedCollateral,
              "lockedCollateral should be 1 ibDUMMY, because Bob locked 1 ibDUMMY"
            ).to.be.equal(WeiPerWad)
            expect(bobPosition.debtShare, "debtShare should be 1 AUSD, because Bob drew 1 AUSD").to.be.equal(WeiPerWad)
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, bobPositionAddress),
              "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
            ).to.be.equal(0)
            expect(bobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)

            // 3. Bob try to move position to Alice position
            const movePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("movePosition", [
              positionManager.address,
              2,
              1,
            ])
            await expect(
              bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, movePosition)
            ).to.be.revertedWith("owner not allowed")
          })
        })
      })
    })

    context("owner position allow other user to manage position with user wallet address", async () => {
      context("move collateral", async () => {
        context("same collateral pool", async () => {
          context("and Bob move collateral of Alice to himself", async () => {
            it("should success", async () => {
              // 1. Alice open a new position with 2 ibDUMMY and draw 1 AUSD
              const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "openLockTokenAndDraw",
                [
                  positionManager.address,
                  stabilityFeeCollector.address,
                  ibTokenAdapter.address,
                  stablecoinAdapter.address,
                  COLLATERAL_POOL_ID,
                  WeiPerWad.mul(2),
                  WeiPerWad,
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ]
              )
              await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
              await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
              const alicePositionAddress = await positionManager.positions(1)
              const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
              const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
              expect(
                alicePosition.lockedCollateral,
                "lockedCollateral should be 2 ibDUMMY, because Alice locked 2 ibDUMMY"
              ).to.be.equal(WeiPerWad.mul(2))
              expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                WeiPerWad
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
              ).to.be.equal(0)
              expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
              // 2. Bob open a position with 1 ibDUMMY and draw 1 AUSD
              const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "openLockTokenAndDraw",
                [
                  positionManager.address,
                  stabilityFeeCollector.address,
                  ibTokenAdapter.address,
                  stablecoinAdapter.address,
                  COLLATERAL_POOL_ID,
                  WeiPerWad,
                  WeiPerWad,
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
                ]
              )
              await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
              await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobOpenPositionCall)
              const bobPositionAddress = await positionManager.positions(2)
              const bobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
              const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, bobPositionAddress)
              expect(
                bobPosition.lockedCollateral,
                "lockedCollateral should be 1 ibDUMMY, because Bob locked 1 ibDUMMY"
              ).to.be.equal(WeiPerWad)
              expect(bobPosition.debtShare, "debtShare should be 1 AUSD, because Bob drew 1 AUSD").to.be.equal(
                WeiPerWad
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
                "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
              ).to.be.equal(0)
              expect(bobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
              // 3. Alice try to unlock 1 ibDUMMY at her position
              const adjustPosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("adjustPosition", [
                positionManager.address,
                await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                WeiPerWad.mul(-1),
                0,
                ibTokenAdapter.address,
                ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
              ])
              await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, adjustPosition)
              const aliceAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
              expect(
                aliceAdjustPosition.lockedCollateral,
                "lockedCollateral should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY"
              ).to.be.equal(WeiPerWad)
              expect(
                aliceAdjustPosition.debtShare,
                "debtShare should be 1 AUSD, because Alice didn't drew more"
              ).to.be.equal(WeiPerWad)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY into the position"
              ).to.be.equal(WeiPerWad)

              // 4. Alice allow Bob to manage position
              const allowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "allowManagePosition",
                [positionManager.address, 1, bobAddress, 1]
              )
              await aliceProxyWallet["execute(address,bytes)"](
                alpacaStablecoinProxyActions.address,
                allowManagePosition
              )
              expect(await positionManager.ownerWhitelist(aliceProxyWallet.address, 1, bobAddress)).to.be.equal(1)

              // 5. Bob try to move collateral of Alice position to Bob position
              await positionManagerAsBob["moveCollateral(uint256,address,uint256,address,bytes)"](
                await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                bobPositionAddress,
                WeiPerWad,
                ibTokenAdapter.address,
                ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
              )

              const aliceAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
              const bobAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(bobAddress)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 0 ibDUMMY, because Bob move 1 ibDUMMY to his position"
              ).to.be.equal(0)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
                "collateralToken inside Alice's position address should be 1 ibDUMMY, because Bob move 1 ibDUMMY to his position"
              ).to.be.equal(WeiPerWad)
              expect(
                aliceAlpacaStablecoinBalancefinal,
                "Alice should receive 1 AUSD, because Alice drew 1 time"
              ).to.be.equal(WeiPerWad)
              expect(bobAlpacaStablecoinBalancefinal, "Bob should receive 1 AUSD, because Bob drew 1 time").to.be.equal(
                WeiPerWad
              )
            })
          })
        })
        context("between collateral pool", async () => {
          context("and Bob move collateral of Alice to himself", async () => {
            it("should success", async () => {
              // 1. Alice open a new position with 2 ibDUMMY and draw 1 AUSD
              const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "openLockTokenAndDraw",
                [
                  positionManager.address,
                  stabilityFeeCollector.address,
                  ibTokenAdapter.address,
                  stablecoinAdapter.address,
                  COLLATERAL_POOL_ID,
                  WeiPerWad.mul(2),
                  WeiPerWad,
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
                ]
              )
              await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
              await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
              const alicePositionAddress = await positionManager.positions(1)
              const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
              const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
              expect(
                alicePosition.lockedCollateral,
                "lockedCollateral should be 2 ibDUMMY, because Alice locked 2 ibDUMMY"
              ).to.be.equal(WeiPerWad.mul(2))
              expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
                WeiPerWad
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
              ).to.be.equal(0)
              expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
              // 2. Bob open a position at collateral pool 2 with 2 ibDUMMY and draw 1 AUSD
              const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "openLockTokenAndDraw",
                [
                  positionManager.address,
                  stabilityFeeCollector.address,
                  ibTokenAdapter2.address,
                  stablecoinAdapter.address,
                  COLLATERAL_POOL_ID2,
                  WeiPerWad.mul(2),
                  WeiPerWad,
                  true,
                  ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
                ]
              )
              await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
              await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobOpenPositionCall)
              const bobPositionAddress = await positionManager.positions(2)
              const bobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
              const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID2, bobPositionAddress)
              expect(
                bobPosition.lockedCollateral,
                "lockedCollateral should be 2 ibDUMMY, because Bob locked 2 ibDUMMY"
              ).to.be.equal(WeiPerWad.mul(2))
              expect(bobPosition.debtShare, "debtShare should be 1 AUSD, because Bob drew 1 AUSD").to.be.equal(
                WeiPerWad
              )
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, bobPositionAddress),
                "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
              ).to.be.equal(0)
              expect(bobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
              // 3. Alice try to unlock 1 ibDUMMY at her position
              const adjustPosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("adjustPosition", [
                positionManager.address,
                await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                WeiPerWad.mul(-1),
                0,
                ibTokenAdapter.address,
                ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
              ])
              await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, adjustPosition)
              const aliceAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
              expect(
                aliceAdjustPosition.lockedCollateral,
                "lockedCollateral should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY"
              ).to.be.equal(WeiPerWad)
              expect(
                aliceAdjustPosition.debtShare,
                "debtShare should be 1 AUSD, because Alice didn't drew more"
              ).to.be.equal(WeiPerWad)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 1 ibDUMMY, because Alice unlocked 1 ibDUMMY"
              ).to.be.equal(WeiPerWad)

              // 4. Alice allow Bob to manage her position
              const allowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData(
                "allowManagePosition",
                [positionManager.address, 1, bobAddress, 1]
              )
              await aliceProxyWallet["execute(address,bytes)"](
                alpacaStablecoinProxyActions.address,
                allowManagePosition
              )
              expect(await positionManager.ownerWhitelist(aliceProxyWallet.address, 1, bobAddress)).to.be.equal(1)

              // 5. Bob try to move collateral of Alice position to his position
              await positionManagerAsBob["moveCollateral(uint256,address,uint256,address,bytes)"](
                await positionManager.ownerLastPositionId(aliceProxyWallet.address),
                bobPositionAddress,
                WeiPerWad,
                ibTokenAdapter.address,
                ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
              )
              const aliceAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
              const bobAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(bobAddress)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
                "collateralToken inside Alice's position address should be 0 ibDUMMY, because Bob move 1 ibDUMMY to his position"
              ).to.be.equal(0)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
                "collateralToken inside Bob's position address should be 1 ibDUMMY at collater pool 1, because Bob move 1 ibDUMMY to his position"
              ).to.be.equal(WeiPerWad)
              expect(
                await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, bobPositionAddress),
                "collateralToken inside Bob's position address should be 0 ibDUMMY at collater pool 2, because Bob move 1 ibDUMMY to his position at collateral pool 1"
              ).to.be.equal(0)
              expect(
                aliceAlpacaStablecoinBalancefinal,
                "Alice should receive 1 AUSD, because Alice drew 1 time"
              ).to.be.equal(WeiPerWad)
              expect(bobAlpacaStablecoinBalancefinal, "Bob should receive 1 AUSD, because Bob drew 1 time").to.be.equal(
                WeiPerWad
              )
            })
          })
        })
      })
      context("mint AUSD", async () => {
        it("should success", async () => {
          // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            COLLATERAL_POOL_ID,
            WeiPerWad.mul(2),
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
            "lockedCollateral should be 2 ibDUMMY, because Alice locked 2 ibDUMMY"
          ).to.be.equal(WeiPerWad.mul(2))
          expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
            WeiPerWad
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
          // 2. Alice allow Bob to manage position
          const allowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("allowManagePosition", [
            positionManager.address,
            1,
            bobAddress,
            1,
          ])
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, allowManagePosition)
          expect(await positionManager.ownerWhitelist(aliceProxyWallet.address, 1, bobAddress)).to.be.equal(1)
          // 3. Bob try to mint AUSD at Alice position
          await positionManagerAsBob.adjustPosition(
            await positionManager.ownerLastPositionId(aliceProxyWallet.address),
            0,
            alicePosition.debtShare,
            ibTokenAdapter.address,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
          )

          // move stablecoin of alice to bob
          await positionManagerAsBob.moveStablecoin(
            await positionManager.ownerLastPositionId(aliceProxyWallet.address),
            bobAddress,
            WeiPerRad
          )

          // allow bob to window
          await bookKeeperAsBob.whitelist(stablecoinAdapter.address)

          // mint ausd
          await stablecoinAdapterAsBob.withdraw(
            bobAddress,
            WeiPerWad,
            ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress])
          )
          const alpacaStablecoinBalance2 = await alpacaStablecoin.balanceOf(aliceAddress)
          const BobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
          const aliceAdjustPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          expect(
            aliceAdjustPosition.lockedCollateral,
            "lockedCollateral should be 2 ibDUMMY, because Alice doesn't add ibDUMMY"
          ).to.be.equal(WeiPerWad.mul(2))
          expect(aliceAdjustPosition.debtShare, "debtShare should be 2 AUSD, because Alice drew more").to.be.equal(
            WeiPerWad.mul(2)
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance2, "Alice should receive 1 AUSD from Alice drew 1 time").to.be.equal(WeiPerWad)
          expect(BobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from Alice position").to.be.equal(WeiPerWad)
        })
      })
      context("move position", async () => {
        context("same collateral pool", async () => {
          it("should success", async () => {
            // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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
            expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
              WeiPerWad
            )
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
              "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
            ).to.be.equal(0)
            expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
            // 2. Bob open a position with 1 ibDUMMY and draw 1 AUSD
            const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
              "openLockTokenAndDraw",
              [
                positionManager.address,
                stabilityFeeCollector.address,
                ibTokenAdapter.address,
                stablecoinAdapter.address,
                COLLATERAL_POOL_ID,
                WeiPerWad,
                WeiPerWad,
                true,
                ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
              ]
            )
            await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
            await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobOpenPositionCall)
            const bobPositionAddress = await positionManager.positions(2)
            const bobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
            const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID, bobPositionAddress)
            expect(
              bobPosition.lockedCollateral,
              "lockedCollateral should be 1 ibDUMMY, because Bob locked 1 ibDUMMY"
            ).to.be.equal(WeiPerWad)
            expect(bobPosition.debtShare, "debtShare should be 1 AUSD, because Bob drew 1 AUSD").to.be.equal(WeiPerWad)
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
              "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
            ).to.be.equal(0)
            expect(bobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
            // 3. Alice allow Bob to manage position
            const allowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData(
              "allowManagePosition",
              [positionManager.address, 1, bobAddress, 1]
            )
            await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, allowManagePosition)
            expect(await positionManager.ownerWhitelist(aliceProxyWallet.address, 1, bobAddress)).to.be.equal(1)

            // 4. bob proxy wallet allow Bob address to manage position
            const bobAllowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData(
              "allowManagePosition",
              [positionManager.address, 2, bobAddress, 1]
            )
            await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobAllowManagePosition)
            expect(await positionManager.ownerWhitelist(bobProxyWallet.address, 2, bobAddress)).to.be.equal(1)

            // 5. Bob try to move collateral to alice position
            await positionManagerAsBob.movePosition(2, 1)
            const aliceAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(aliceAddress)
            const bobAlpacaStablecoinBalancefinal = await alpacaStablecoin.balanceOf(bobAddress)
            const alicePositionAfterMovePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
            expect(
              alicePositionAfterMovePosition.lockedCollateral,
              "lockedCollateral should be 2 ibDUMMY, because Bob move locked 1 ibDUMMY to Alice"
            ).to.be.equal(WeiPerWad.mul(2))
            expect(
              alicePositionAfterMovePosition.debtShare,
              "debtShare should be 1 AUSD, because Bob move DebtShare to Alice"
            ).to.be.equal(WeiPerWad.mul(2))
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
              "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice all lock collateral"
            ).to.be.equal(0)
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobPositionAddress),
              "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob all lock collateral"
            ).to.be.equal(0)
            expect(
              aliceAlpacaStablecoinBalancefinal,
              "Alice should receive 1 AUSD, because Alice drew 1 time"
            ).to.be.equal(WeiPerWad)
            expect(bobAlpacaStablecoinBalancefinal, "Bob should receive 1 AUSD, because Bob drew 1 time").to.be.equal(
              WeiPerWad
            )
          })
        })
        context("between 2 collateral pool", async () => {
          it("should revert", async () => {
            // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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
            expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(
              WeiPerWad
            )
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
              "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
            ).to.be.equal(0)
            expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
            // 2. Bob open a position with 1 ibDUMMY and draw 1 AUSD at collateral pool id 2
            const bobOpenPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
              "openLockTokenAndDraw",
              [
                positionManager.address,
                stabilityFeeCollector.address,
                ibTokenAdapter2.address,
                stablecoinAdapter.address,
                COLLATERAL_POOL_ID2,
                WeiPerWad,
                WeiPerWad,
                true,
                ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
              ]
            )
            await ibDUMMYasBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))
            await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobOpenPositionCall)
            const bobPositionAddress = await positionManager.positions(2)
            const bobAlpacaStablecoinBalance = await alpacaStablecoin.balanceOf(bobAddress)
            const bobPosition = await bookKeeper.positions(COLLATERAL_POOL_ID2, bobPositionAddress)
            expect(
              bobPosition.lockedCollateral,
              "lockedCollateral should be 1 ibDUMMY, because Bob locked 1 ibDUMMY"
            ).to.be.equal(WeiPerWad)
            expect(bobPosition.debtShare, "debtShare should be 1 AUSD, because Bob drew 1 AUSD").to.be.equal(WeiPerWad)
            expect(
              await bookKeeper.collateralToken(COLLATERAL_POOL_ID2, bobPositionAddress),
              "collateralToken inside Bob's position address should be 0 ibDUMMY, because Bob locked all ibDUMMY into the position"
            ).to.be.equal(0)
            expect(bobAlpacaStablecoinBalance, "Bob should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)

            // 3. Alice allow Bob to manage position
            const allowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData(
              "allowManagePosition",
              [positionManager.address, 1, bobAddress, 1]
            )
            await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, allowManagePosition)
            expect(await positionManager.ownerWhitelist(aliceProxyWallet.address, 1, bobAddress)).to.be.equal(1)

            // 4. bob proxy wallet allow Bob address to manage position
            const bobAllowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData(
              "allowManagePosition",
              [positionManager.address, 2, bobAddress, 1]
            )
            await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bobAllowManagePosition)
            expect(await positionManager.ownerWhitelist(bobProxyWallet.address, 2, bobAddress)).to.be.equal(1)

            // 5. Bob try to move position to Alice position
            await expect(positionManagerAsBob.movePosition(2, 1)).to.be.revertedWith("!same collateral pool")
          })
        })
      })
    })

    context("owner position can export and can import", async () => {
      it("should success", async () => {
        // 1. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
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

        // 2. alice allow manage position
        const allowManagePosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("allowManagePosition", [
          positionManager.address,
          1,
          aliceAddress,
          1,
        ])
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, allowManagePosition)
        expect(await positionManager.ownerWhitelist(aliceProxyWallet.address, 1, aliceAddress)).to.be.equal(1)

        // 3. alice allow positionManage
        await bookKeeperAsAlice.whitelist(positionManager.address)

        // 4. alice allow migration
        await positionManagerAsAlice.allowMigratePosition(aliceProxyWallet.address, 1)
        expect(await positionManager.migrationWhitelist(aliceAddress, aliceProxyWallet.address)).to.be.equal(1)

        // 5. Alice export position
        const exportPosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("exportPosition", [
          positionManager.address,
          1,
          aliceAddress,
        ])
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, exportPosition)
        const alicePositionAfterExport = await bookKeeper.positions(COLLATERAL_POOL_ID, aliceAddress)
        expect(
          alicePositionAfterExport.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice export"
        ).to.be.equal(WeiPerWad)
        expect(alicePositionAfterExport.debtShare, "debtShare should be 1 AUSD, because Alice export").to.be.equal(
          WeiPerWad
        )
        const alicePositionWalletPositionAfterExport = await bookKeeper.positions(
          COLLATERAL_POOL_ID,
          alicePositionAddress
        )
        expect(
          alicePositionWalletPositionAfterExport.lockedCollateral,
          "lockedCollateral should be 0 ibDUMMY, because Alice export"
        ).to.be.equal(0)
        expect(
          alicePositionWalletPositionAfterExport.debtShare,
          "debtShare should be 0 AUSD, because Alice export"
        ).to.be.equal(0)

        //6. alice import position back
        const importPosition = alpacaStablecoinProxyActions.interface.encodeFunctionData("importPosition", [
          positionManager.address,
          aliceAddress,
          1,
        ])
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, importPosition)
        const alicePositionAfterImport = await bookKeeper.positions(COLLATERAL_POOL_ID, aliceAddress)
        expect(
          alicePositionAfterImport.lockedCollateral,
          "lockedCollateral should be 0 ibDUMMY, because Alice Import"
        ).to.be.equal(0)
        expect(alicePositionAfterImport.debtShare, "debtShare should be 0 AUSD, because Alice Import").to.be.equal(0)
        const alicePositionWalletPositionAfterImport = await bookKeeper.positions(
          COLLATERAL_POOL_ID,
          alicePositionAddress
        )
        expect(
          alicePositionWalletPositionAfterImport.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice Import"
        ).to.be.equal(WeiPerWad)
        expect(
          alicePositionWalletPositionAfterImport.debtShare,
          "debtShare should be 1 AUSD, because Alice Import"
        ).to.be.equal(WeiPerWad)
      })
    })
  })
})
