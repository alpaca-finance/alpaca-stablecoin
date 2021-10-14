import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
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
  SystemDebtEngine__factory,
  SystemDebtEngine,
  PriceOracle,
  PriceOracle__factory,
  SimplePriceFeed__factory,
  SimplePriceFeed,
  GetPositions__factory,
  GetPositions,
  AccessControlConfig__factory,
  AccessControlConfig,
  CollateralPoolConfig__factory,
  CollateralPoolConfig,
} from "../../../typechain"
import { expect } from "chai"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"
import { loadProxyWalletFixtureHandler } from "../../helper/proxy"

import * as AssertHelpers from "../../helper/assert"
import { AddressZero } from "../../helper/address"
import { advanceBlock } from "../../helper/time"

const { formatBytes32String } = ethers.utils
const { Zero } = ethers.constants

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
  simplePriceFeed: SimplePriceFeed
  systemDebtEngine: SystemDebtEngine
  getPositions: GetPositions
  collateralPoolConfig: CollateralPoolConfig
}

const ALPACA_PER_BLOCK = ethers.utils.parseEther("100")
const COLLATERAL_POOL_ID = formatBytes32String("ibDUMMY")
const CLOSE_FACTOR_BPS = BigNumber.from(5000)
const LIQUIDATOR_INCENTIVE_BPS = BigNumber.from(10250)
const TREASURY_FEE_BPS = BigNumber.from(5000)

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

  await accessControlConfig.grantRole(await accessControlConfig.PRICE_ORACLE_ROLE(), deployer.address)
  await accessControlConfig.grantRole(await accessControlConfig.BOOK_KEEPER_ROLE(), bookKeeper.address)
  await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const ibDUMMY = await BEP20.deploy("ibDUMMY", "ibDUMMY")
  await ibDUMMY.deployed()
  await ibDUMMY.mint(await alice.getAddress(), ethers.utils.parseEther("1000000"))
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

  // Deploy PositionManager
  const PositionManager = (await ethers.getContractFactory("PositionManager", deployer)) as PositionManager__factory
  const positionManager = (await upgrades.deployProxy(PositionManager, [
    bookKeeper.address,
    bookKeeper.address,
  ])) as PositionManager
  await positionManager.deployed()
  await accessControlConfig.grantRole(await accessControlConfig.POSITION_MANAGER_ROLE(), positionManager.address)

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

  await accessControlConfig.grantRole(
    ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]),
    ibTokenAdapter.address
  )
  await accessControlConfig.grantRole(await accessControlConfig.MINTABLE_ROLE(), deployer.address)

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

  const PriceOracle = (await ethers.getContractFactory("PriceOracle", deployer)) as PriceOracle__factory
  const priceOracle = (await upgrades.deployProxy(PriceOracle, [bookKeeper.address])) as PriceOracle

  const SimplePriceFeed = (await ethers.getContractFactory("SimplePriceFeed", deployer)) as SimplePriceFeed__factory
  const simplePriceFeed = (await upgrades.deployProxy(SimplePriceFeed, [
    accessControlConfig.address,
  ])) as SimplePriceFeed
  await simplePriceFeed.deployed()

  const GetPositions = (await ethers.getContractFactory("GetPositions", deployer)) as GetPositions__factory
  const getPositions = (await upgrades.deployProxy(GetPositions, [])) as GetPositions

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
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10000000))

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
    simplePriceFeed,
    systemDebtEngine,
    getPositions,
    collateralPoolConfig,
  }
}

describe("GetPositions", () => {
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
  let bobProxyWallet: ProxyWallet

  let ibTokenAdapter: IbTokenAdapter
  let stablecoinAdapter: StablecoinAdapter
  let bookKeeper: BookKeeper
  let ibDUMMY: BEP20
  let shield: Shield
  let alpacaToken: AlpacaToken
  let fairLaunch: FairLaunch
  let collateralPoolConfig: CollateralPoolConfig

  let positionManager: PositionManager
  let positionManagerAsBob: PositionManager

  let stabilityFeeCollector: StabilityFeeCollector

  let alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions

  let alpacaStablecoin: AlpacaStablecoin

  let simplePriceFeed: SimplePriceFeed

  let systemDebtEngine: SystemDebtEngine

  let getPositions: GetPositions

  // Signer
  let ibTokenAdapterAsAlice: IbTokenAdapter
  let ibTokenAdapterAsBob: IbTokenAdapter

  let ibDUMMYasAlice: BEP20
  let ibDUMMYasBob: BEP20

  let simplePriceFeedAsDeployer: SimplePriceFeed

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
      simplePriceFeed,
      systemDebtEngine,
      getPositions,
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

    simplePriceFeedAsDeployer = SimplePriceFeed__factory.connect(simplePriceFeed.address, deployer)

    bookKeeperAsBob = BookKeeper__factory.connect(bookKeeper.address, bob)
    positionManagerAsBob = PositionManager__factory.connect(positionManager.address, bob)
  })
  describe("#getPositionWithSafetyBuffer", async () => {
    context("multiple positions at risks", async () => {
      it("should query all positions at risks", async () => {
        await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1"),
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        await advanceBlock()

        const openPositionCall2 = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          ethers.utils.parseEther("2"),
          ethers.utils.parseEther("1"),
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall2)
        await advanceBlock()

        const openPositionCall3 = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          ethers.utils.parseEther("1.5"),
          ethers.utils.parseEther("1"),
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall3)
        await advanceBlock()

        await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, ethers.utils.parseEther("0.9").mul(1e9))
        const positions = await getPositions.getPositionWithSafetyBuffer(positionManager.address, 1, 40)
        expect(positions._debtShares[0]).to.be.equal(WeiPerWad)
        expect(positions._debtShares[1]).to.be.equal(WeiPerWad)
        expect(positions._debtShares[2]).to.be.equal(WeiPerWad)
        expect(positions._safetyBuffers[0]).to.be.equal(Zero)
        expect(positions._safetyBuffers[1]).to.be.equal(WeiPerRad.mul(8).div(10))
        expect(positions._safetyBuffers[2]).to.be.equal(WeiPerRad.mul(35).div(100))
      })
    })
  })

  describe("#getAllPostionsAsc, #getPositionsAsc, #getAllPositionsDesc, #getPositionsDesc", async () => {
    context("when Bob opened 11 positions", async () => {
      context("when calling each getPositions function", async () => {
        it("should return correctly", async () => {
          const open = async () => {
            const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
              positionManagerAsBob.address,
              stabilityFeeCollector.address,
              ibTokenAdapter.address,
              stablecoinAdapter.address,
              COLLATERAL_POOL_ID,
              ethers.utils.parseEther("2"),
              ethers.utils.parseEther("1"),
              true,
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ])
            return bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
          }

          const open11 = async () => {
            await ibDUMMYasBob.approve(bobProxyWallet.address, MaxUint256)
            for (let i = 0; i < 11; i++) {
              await (await open()).wait()
              // call advanceBlock to prevent unknown random revert
              await advanceBlock()
            }
          }

          await open11()

          /**
           * #getAllPositionsDesc
           */
          {
            const [ids, positions, collateralPools] = await getPositions.getAllPositionsAsc(
              positionManagerAsBob.address,
              bobProxyWallet.address
            )

            expect(ids.length).to.be.equal(11)
            expect(positions.length).to.be.equal(11)
            expect(collateralPools.length).to.be.equal(11)
            expect(ids[0]).to.be.equal(1)
            expect(ids[10]).to.be.equal(11)
          }

          /**
           * #getAllPositionsDesc
           */
          {
            const [ids, positions, collateralPools] = await getPositions.getAllPositionsDesc(
              positionManagerAsBob.address,
              bobProxyWallet.address
            )

            expect(ids.length).to.be.equal(11)
            expect(positions.length).to.be.equal(11)
            expect(collateralPools.length).to.be.equal(11)
            expect(ids[0]).to.be.equal(11)
            expect(ids[10]).to.be.equal(1)
          }

          /**
           * #getPositionsAsc
           */
          {
            // 1st page
            let from = await positionManagerAsBob.ownerFirstPositionId(bobProxyWallet.address)
            let [ids, positions, collateralPools] = await getPositions.getPositionsAsc(
              positionManagerAsBob.address,
              from,
              4
            )
            expect(ids.length).to.be.equal(4)
            expect(positions.length).to.be.equal(4)
            expect(collateralPools.length).to.be.equal(4)
            expect(ids[0]).to.be.equal(1)
            expect(ids[3]).to.be.equal(4)

            // 2nd page
            from = ids[3]
            ;[ids, positions, collateralPools] = await getPositions.getPositionsAsc(
              positionManagerAsBob.address,
              from,
              4
            )
            expect(ids.length).to.be.equal(4)
            expect(positions.length).to.be.equal(4)
            expect(collateralPools.length).to.be.equal(4)
            expect(ids[0]).to.be.equal(4)
            expect(ids[3]).to.be.equal(7)

            // 3rd page
            from = ids[3]
            ;[ids, positions, collateralPools] = await getPositions.getPositionsAsc(
              positionManagerAsBob.address,
              from,
              4
            )
            expect(ids.length).to.be.equal(4)
            expect(positions.length).to.be.equal(4)
            expect(collateralPools.length).to.be.equal(4)
            expect(ids[0]).to.be.equal(7)
            expect(ids[3]).to.be.equal(10)

            // 4th page
            from = ids[3]
            ;[ids, positions, collateralPools] = await getPositions.getPositionsAsc(
              positionManagerAsBob.address,
              from,
              4
            )

            // even the page is not filled up, the size will be four
            expect(ids.length).to.be.equal(4)
            expect(positions.length).to.be.equal(4)
            expect(collateralPools.length).to.be.equal(4)
            expect(ids[0]).to.be.equal(10)
            expect(ids[1]).to.be.equal(11)
            expect(ids[2]).to.be.equal(0)
            expect(ids[3]).to.be.equal(0)
          }

          /**
           * #getPositionsDesc
           */
          {
            // 1st page
            let from = await positionManagerAsBob.ownerLastPositionId(bobProxyWallet.address)
            let [ids, positions, collateralPools] = await getPositions.getPositionsDesc(
              positionManagerAsBob.address,
              from,
              4
            )
            expect(ids.length).to.be.equal(4)
            expect(positions.length).to.be.equal(4)
            expect(collateralPools.length).to.be.equal(4)
            expect(ids[0]).to.be.equal(11)
            expect(ids[3]).to.be.equal(8)

            // 2nd page
            from = ids[3]
            ;[ids, positions, collateralPools] = await getPositions.getPositionsDesc(
              positionManagerAsBob.address,
              from,
              4
            )
            expect(ids.length).to.be.equal(4)
            expect(positions.length).to.be.equal(4)
            expect(collateralPools.length).to.be.equal(4)
            expect(ids[0]).to.be.equal(8)
            expect(ids[3]).to.be.equal(5)

            // 3rd page
            from = ids[3]
            ;[ids, positions, collateralPools] = await getPositions.getPositionsDesc(
              positionManagerAsBob.address,
              from,
              4
            )
            expect(ids.length).to.be.equal(4)
            expect(positions.length).to.be.equal(4)
            expect(collateralPools.length).to.be.equal(4)
            expect(ids[0]).to.be.equal(5)
            expect(ids[3]).to.be.equal(2)

            // 4th page
            from = ids[3]
            ;[ids, positions, collateralPools] = await getPositions.getPositionsDesc(
              positionManagerAsBob.address,
              from,
              4
            )

            // even the page is not filled up, the size will be four
            expect(ids.length).to.be.equal(4)
            expect(positions.length).to.be.equal(4)
            expect(collateralPools.length).to.be.equal(4)
            expect(ids[0]).to.be.equal(2)
            expect(ids[1]).to.be.equal(1)
            expect(ids[2]).to.be.equal(0)
            expect(ids[3]).to.be.equal(0)
          }
        })
      })
    })
  })
})
