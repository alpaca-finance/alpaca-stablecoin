import { ethers, upgrades, waffle } from "hardhat"
import { Signer } from "ethers"

import {
  ProxyWallet,
  PositionManager__factory,
  BookKeeper,
  BookKeeper__factory,
  PositionManager,
  AlpacaStablecoinProxyActions,
  AlpacaStablecoinProxyActions__factory,
  BEP20__factory,
  StabilityFeeCollector,
  StabilityFeeCollector__factory,
  AlpacaStablecoin__factory,
  AlpacaStablecoin,
  StablecoinAdapter__factory,
  StablecoinAdapter,
  ShowStopper__factory,
  ShowStopper,
  SystemDebtEngine,
  LiquidationEngine,
  LiquidationEngine__factory,
  SystemDebtEngine__factory,
  PriceOracle,
  PriceOracle__factory,
  MockPriceFeed,
  MockPriceFeed__factory,
  SimplePriceFeed,
  SimplePriceFeed__factory,
  TokenAdapter,
  TokenAdapter__factory,
  GetPositions,
  GetPositions__factory,
} from "../../../typechain"
import { expect } from "chai"
import { loadProxyWalletFixtureHandler } from "../../helper/proxy"
import { formatBytes32String } from "ethers/lib/utils"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"

type Fixture = {
  positionManager: PositionManager
  alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  stabilityFeeCollector: StabilityFeeCollector
  busdTokenAdapter: TokenAdapter
  usdtTokenAdapter: TokenAdapter
  stablecoinAdapter: StablecoinAdapter
  showStopper: ShowStopper
  bookKeeper: BookKeeper
  liquidationEngine: LiquidationEngine
  systemDebtEngine: SystemDebtEngine
  priceOracle: PriceOracle
  getPositions: GetPositions
}

const loadFixtureHandler = async (): Promise<Fixture> => {
  const [deployer, alice, bob, dev] = await ethers.getSigners()

  // Deploy BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory

  const BUSD = await BEP20.deploy("BUSD", "BUSD")
  await BUSD.deployed()
  //   await baseToken.mint(await deployer.getAddress(), ethers.utils.parseEther("100"))
  await BUSD.mint(await alice.getAddress(), ethers.utils.parseEther("100"))
  await BUSD.mint(await bob.getAddress(), ethers.utils.parseEther("100"))

  const USDT = await BEP20.deploy("BUSD", "BUSD")
  await USDT.deployed()
  await USDT.mint(await bob.getAddress(), ethers.utils.parseEther("100"))

  // Deploy AlpacaStablecoin
  const AlpacaStablecoin = new AlpacaStablecoin__factory(deployer)
  const alpacaStablecoin = await AlpacaStablecoin.deploy("Alpaca USD", "AUSD", "31337")

  const BookKeeper = new BookKeeper__factory(deployer)
  const bookKeeper = (await upgrades.deployProxy(BookKeeper)) as BookKeeper

  const PriceOracle = new PriceOracle__factory(deployer)
  const priceOracle = (await upgrades.deployProxy(PriceOracle, [bookKeeper.address])) as PriceOracle

  const SimplePriceFeed = new SimplePriceFeed__factory(deployer)
  const simplePriceFeed = (await upgrades.deployProxy(SimplePriceFeed)) as SimplePriceFeed
  await simplePriceFeed.setPrice(WeiPerWad)

  const PriceFeed = new MockPriceFeed__factory(deployer)
  const priceFeed = await PriceFeed.deploy()

  priceOracle.setPriceFeed(formatBytes32String("BUSD"), simplePriceFeed.address)
  priceOracle.setPriceFeed(formatBytes32String("USDT"), simplePriceFeed.address)

  await bookKeeper.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployer.address)
  await bookKeeper.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), priceOracle.address)

  await bookKeeper.init(formatBytes32String("BUSD"))
  // set pool debt ceiling 100 rad
  await bookKeeper.setDebtCeiling(formatBytes32String("BUSD"), WeiPerRad.mul(100))
  // set price with safety margin 1 ray
  await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BUSD"), WeiPerRay)
  // set position debt floor 1 rad
  await bookKeeper.setDebtFloor(formatBytes32String("BUSD"), WeiPerRad.mul(1))
  // set total debt ceiling 100 rad
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(100))

  await bookKeeper.init(formatBytes32String("USDT"))
  // set pool debt ceiling 100 rad
  await bookKeeper.setDebtCeiling(formatBytes32String("USDT"), WeiPerRad.mul(100))
  // set price with safety margin 1 ray
  await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("USDT"), WeiPerRay)
  // set position debt floor 1 rad
  await bookKeeper.setDebtFloor(formatBytes32String("USDT"), WeiPerRad.mul(1))
  // set total debt ceiling 100 rad
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(100))

  const ShowStopper = new ShowStopper__factory(deployer)
  const showStopper = (await upgrades.deployProxy(ShowStopper)) as ShowStopper

  const PositionManager = new PositionManager__factory(deployer)
  const positionManager = (await upgrades.deployProxy(PositionManager, [
    bookKeeper.address,
    showStopper.address,
  ])) as PositionManager

  const GetPositions = new GetPositions__factory(deployer)
  const getPositions = await GetPositions.deploy()

  const AlpacaStablecoinProxyActions = new AlpacaStablecoinProxyActions__factory(deployer)
  const alpacaStablecoinProxyActions = await AlpacaStablecoinProxyActions.deploy()

  const TokenAdapter = new TokenAdapter__factory(deployer)
  const busdTokenAdapter = (await upgrades.deployProxy(TokenAdapter, [
    bookKeeper.address,
    formatBytes32String("BUSD"),
    BUSD.address,
  ])) as TokenAdapter

  const usdtTokenAdapter = (await upgrades.deployProxy(TokenAdapter, [
    bookKeeper.address,
    formatBytes32String("USDT"),
    USDT.address,
  ])) as TokenAdapter

  const StablecoinAdapter = new StablecoinAdapter__factory(deployer)
  const stablecoinAdapter = (await upgrades.deployProxy(StablecoinAdapter, [
    bookKeeper.address,
    alpacaStablecoin.address,
  ])) as StablecoinAdapter

  // Deploy StabilityFeeCollector
  const StabilityFeeCollector = new StabilityFeeCollector__factory(deployer)
  const stabilityFeeCollector = (await upgrades.deployProxy(StabilityFeeCollector, [
    bookKeeper.address,
  ])) as StabilityFeeCollector

  await stabilityFeeCollector.init(formatBytes32String("BUSD"))
  await stabilityFeeCollector.init(formatBytes32String("USDT"))

  const SystemDebtEngine = new SystemDebtEngine__factory(deployer)
  const systemDebtEngine = (await upgrades.deployProxy(SystemDebtEngine, [bookKeeper.address])) as SystemDebtEngine

  const LiquidationEngine = new LiquidationEngine__factory(deployer)
  const liquidationEngine = (await upgrades.deployProxy(LiquidationEngine, [
    bookKeeper.address,
    systemDebtEngine.address,
  ])) as LiquidationEngine

  await showStopper.setBookKeeper(bookKeeper.address)
  await showStopper.setLiquidationEngine(liquidationEngine.address)
  await showStopper.setSystemDebtEngine(systemDebtEngine.address)
  await showStopper.setPriceOracle(priceOracle.address)

  await bookKeeper.grantRole(await bookKeeper.LIQUIDATION_ENGINE_ROLE(), liquidationEngine.address)
  await bookKeeper.grantRole(await bookKeeper.LIQUIDATION_ENGINE_ROLE(), showStopper.address)
  await bookKeeper.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), priceOracle.address)
  await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), busdTokenAdapter.address)
  await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), usdtTokenAdapter.address)
  await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), positionManager.address)
  await bookKeeper.grantRole(await bookKeeper.STABILITY_FEE_COLLECTOR_ROLE(), stabilityFeeCollector.address)
  await alpacaStablecoin.grantRole(await alpacaStablecoin.MINTER_ROLE(), stablecoinAdapter.address)

  return {
    positionManager,
    alpacaStablecoinProxyActions,
    stabilityFeeCollector,
    busdTokenAdapter,
    usdtTokenAdapter,
    stablecoinAdapter,
    showStopper,
    bookKeeper,
    liquidationEngine,
    systemDebtEngine,
    priceOracle,
    getPositions,
  }
}

describe("ShowStopper", () => {
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

  // Proxy wallet
  let deployerProxyWallet: ProxyWallet
  let aliceProxyWallet: ProxyWallet
  let bobProxyWallet: ProxyWallet

  // Contract
  let positionManager: PositionManager
  let alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  let showStopper: ShowStopper
  let bookKeeper: BookKeeper
  let liquidationEngine: LiquidationEngine
  let systemDebtEngine: SystemDebtEngine
  let priceOracle: PriceOracle
  let priceFeed: MockPriceFeed
  let stabilityFeeCollector: StabilityFeeCollector
  let busdTokenAdapter: TokenAdapter
  let usdtTokenAdapter: TokenAdapter
  let stablecoinAdapter: StablecoinAdapter
  let getPositions: GetPositions

  let showStopperAsAlice: ShowStopper
  let stablecoinAdapterAsAlice: StablecoinAdapter
  let bookKeeperAsAlice: BookKeeper

  beforeEach(async () => {
    ;({
      alpacaStablecoinProxyActions,
      positionManager,
      stabilityFeeCollector,
      busdTokenAdapter,
      usdtTokenAdapter,
      stablecoinAdapter,
      showStopper,
      bookKeeper,
      liquidationEngine,
      systemDebtEngine,
      priceOracle,
    } = await loadFixtureHandler())
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])
    ;({
      proxyWallets: [deployerProxyWallet, aliceProxyWallet, bobProxyWallet],
    } = await loadProxyWalletFixtureHandler())

    const busdAsAlice = BEP20__factory.connect(await busdTokenAdapter.collateralToken(), alice)
    const busdAsBob = BEP20__factory.connect(await busdTokenAdapter.collateralToken(), bob)

    busdAsAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
    busdAsBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))

    const usdtAsAlice = BEP20__factory.connect(await usdtTokenAdapter.collateralToken(), alice)
    const usdtAsBob = BEP20__factory.connect(await usdtTokenAdapter.collateralToken(), bob)

    usdtAsAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
    usdtAsBob.approve(bobProxyWallet.address, WeiPerWad.mul(10000))

    showStopperAsAlice = ShowStopper__factory.connect(showStopper.address, alice)
    stablecoinAdapterAsAlice = StablecoinAdapter__factory.connect(stablecoinAdapter.address, alice)
    bookKeeperAsAlice = BookKeeper__factory.connect(bookKeeper.address, alice)

    const stablecoinAsAlice = AlpacaStablecoin__factory.connect(await stablecoinAdapter.stablecoin(), alice)

    stablecoinAsAlice.approve(stablecoinAdapter.address, WeiPerWad.mul(10000))
  })

  describe("#cage", () => {
    context("when doesn't grant showStopperRole for showStopper", () => {
      it("should be revert", async () => {
        await expect(showStopper["cage()"]()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })
    context("when doesn't grant showStopperRole for liquidationEngine", () => {
      it("should be revert", async () => {
        await bookKeeper.grantRole(await bookKeeper.SHOW_STOPPER_ROLE(), showStopper.address)

        await expect(showStopper["cage()"]()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })
    context("when doesn't grant showStopperRole for systemDebtEngine", () => {
      it("should be revert", async () => {
        await bookKeeper.grantRole(await bookKeeper.SHOW_STOPPER_ROLE(), showStopper.address)
        await liquidationEngine.grantRole(await liquidationEngine.SHOW_STOPPER_ROLE(), showStopper.address)

        await expect(showStopper["cage()"]()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })
    context("when doesn't grant showStopperRole for priceOracle", () => {
      it("should be revert", async () => {
        await bookKeeper.grantRole(await bookKeeper.SHOW_STOPPER_ROLE(), showStopper.address)
        await liquidationEngine.grantRole(await liquidationEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await systemDebtEngine.grantRole(await systemDebtEngine.SHOW_STOPPER_ROLE(), showStopper.address)

        await expect(showStopper["cage()"]()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })
    context("when grant showStopperRole for all contract", () => {
      it("should be able to cage", async () => {
        await bookKeeper.grantRole(await bookKeeper.SHOW_STOPPER_ROLE(), showStopper.address)
        await liquidationEngine.grantRole(await liquidationEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await systemDebtEngine.grantRole(await systemDebtEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await priceOracle.grantRole(await priceOracle.SHOW_STOPPER_ROLE(), showStopper.address)

        await showStopper["cage()"]()

        expect(await bookKeeper.live()).to.be.equal(0)
        expect(await liquidationEngine.live()).to.be.equal(0)
        expect(await systemDebtEngine.live()).to.be.equal(0)
        expect(await priceOracle.live()).to.be.equal(0)
      })
    })
  })
  describe("#cage(collateralPoolId)", () => {
    context("deployer cage BUSD pool", () => {
      it("should be able to cage", async () => {
        // 1.
        //  a. open a new position
        //  b. lock ibBUSD
        //  c. mint AUSD
        const openLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "openLockTokenAndDraw",
          [
            positionManager.address,
            stabilityFeeCollector.address,
            busdTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("BUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openLockTokenAndDrawCall)

        await bookKeeper.grantRole(await bookKeeper.SHOW_STOPPER_ROLE(), showStopper.address)
        await liquidationEngine.grantRole(await liquidationEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await systemDebtEngine.grantRole(await systemDebtEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await priceOracle.grantRole(await priceOracle.SHOW_STOPPER_ROLE(), showStopper.address)

        await showStopper["cage()"]()

        await showStopper["cage(bytes32)"](formatBytes32String("BUSD"))

        expect(await showStopper.cagePrice(formatBytes32String("BUSD"))).to.be.equal(WeiPerRay)
        expect(await showStopper.totalDebtShare(formatBytes32String("BUSD"))).to.be.equal(WeiPerWad.mul(5))
      })
    })
  })
  describe("#accumulateBadDebt, #redeemLockedCollateral", () => {
    context("when the caller is not the position owner", () => {
      it("should be able to redeemLockedCollateral", async () => {
        // alice's position #1
        //  a. open a new position
        //  b. lock ibBUSD
        //  c. mint AUSD
        const openLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "openLockTokenAndDraw",
          [
            positionManager.address,
            stabilityFeeCollector.address,
            busdTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("BUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openLockTokenAndDrawCall)

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        await bookKeeper.grantRole(await bookKeeper.SHOW_STOPPER_ROLE(), showStopper.address)
        await liquidationEngine.grantRole(await liquidationEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await systemDebtEngine.grantRole(await systemDebtEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await priceOracle.grantRole(await priceOracle.SHOW_STOPPER_ROLE(), showStopper.address)

        await showStopper["cage()"]()

        await showStopper["cage(bytes32)"](formatBytes32String("BUSD"))

        // accumulate bad debt posiion #1
        await showStopper.accumulateBadDebt(formatBytes32String("BUSD"), positionAddress)

        // redeem lock collateral position #1
        const redeemLockedCollateralCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "redeemLockedCollateral",
          [
            positionManager.address,
            positionId,
            busdTokenAdapter.address,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await expect(
          bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, redeemLockedCollateralCall)
        ).to.be.revertedWith("owner not allowed")
      })
    })
    context("when the caller is the position owner", () => {
      it("should be able to redeemLockedCollateral", async () => {
        // alice's position #1
        //  a. open a new position
        //  b. lock ibBUSD
        //  c. mint AUSD
        const openLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "openLockTokenAndDraw",
          [
            positionManager.address,
            stabilityFeeCollector.address,
            busdTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("BUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openLockTokenAndDrawCall)

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        // bob's position #2
        //  a. open a new position
        //  b. lock ibBUSD
        //  c. mint AUSD
        const openLockTokenAndDraw2Call = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "openLockTokenAndDraw",
          [
            positionManager.address,
            stabilityFeeCollector.address,
            busdTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("BUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openLockTokenAndDraw2Call)

        const positionId2 = await positionManager.ownerLastPositionId(bobProxyWallet.address)
        const positionAddress2 = await positionManager.positions(positionId2)

        await bookKeeper.grantRole(await bookKeeper.SHOW_STOPPER_ROLE(), showStopper.address)
        await liquidationEngine.grantRole(await liquidationEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await systemDebtEngine.grantRole(await systemDebtEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await priceOracle.grantRole(await priceOracle.SHOW_STOPPER_ROLE(), showStopper.address)

        await showStopper["cage()"]()

        await showStopper["cage(bytes32)"](formatBytes32String("BUSD"))

        // accumulate bad debt posiion #1
        await showStopper.accumulateBadDebt(formatBytes32String("BUSD"), positionAddress)
        const position1 = await bookKeeper.positions(formatBytes32String("BUSD"), positionAddress)
        expect(position1.lockedCollateral).to.be.equal(WeiPerWad.mul(5))
        expect(position1.debtShare).to.be.equal(0)
        expect(await bookKeeper.collateralToken(formatBytes32String("BUSD"), showStopper.address)).to.be.equal(
          WeiPerWad.mul(5)
        )
        expect(await bookKeeper.systemBadDebt(systemDebtEngine.address)).to.be.equal(WeiPerRad.mul(5))

        // accumulate bad debt posiion #2
        await showStopper.accumulateBadDebt(formatBytes32String("BUSD"), positionAddress2)
        const position2 = await bookKeeper.positions(formatBytes32String("BUSD"), positionAddress2)
        expect(position2.lockedCollateral).to.be.equal(WeiPerWad.mul(5))
        expect(position2.debtShare).to.be.equal(0)
        expect(await bookKeeper.collateralToken(formatBytes32String("BUSD"), showStopper.address)).to.be.equal(
          WeiPerWad.mul(10)
        )
        expect(await bookKeeper.systemBadDebt(systemDebtEngine.address)).to.be.equal(WeiPerRad.mul(10))

        // redeem lock collateral position #1
        const redeemLockedCollateralCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "redeemLockedCollateral",
          [
            positionManager.address,
            positionId,
            busdTokenAdapter.address,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          redeemLockedCollateralCall
        )
        expect((await bookKeeper.positions(formatBytes32String("BUSD"), positionAddress)).lockedCollateral).to.be.equal(
          0
        )
        expect(await bookKeeper.collateralToken(formatBytes32String("BUSD"), aliceProxyWallet.address)).to.be.equal(
          WeiPerWad.mul(5)
        )

        // redeem lock collateral position #2
        const redeemLockedCollateral2Call = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "redeemLockedCollateral",
          [
            positionManager.address,
            positionId2,
            busdTokenAdapter.address,
            ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
          ]
        )
        await bobProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          redeemLockedCollateral2Call
        )
        expect(
          (await bookKeeper.positions(formatBytes32String("BUSD"), positionAddress2)).lockedCollateral
        ).to.be.equal(0)
        expect(await bookKeeper.collateralToken(formatBytes32String("BUSD"), bobProxyWallet.address)).to.be.equal(
          WeiPerWad.mul(5)
        )
      })
    })
  })
  describe("#finalizeDebt, #finalizeCashPrice", () => {
    context("when finalizeDebt and finalizeCashPrice", () => {
      it("should be able to call", async () => {
        // alice's position #1
        //  a. open a new position
        //  b. lock ibBUSD
        //  c. mint AUSD
        const openLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "openLockTokenAndDraw",
          [
            positionManager.address,
            stabilityFeeCollector.address,
            busdTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("BUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openLockTokenAndDrawCall)

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        // bob's position #2
        //  a. open a new position
        //  b. lock ibBUSD
        //  c. mint AUSD
        const openLockTokenAndDraw2Call = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "openLockTokenAndDraw",
          [
            positionManager.address,
            stabilityFeeCollector.address,
            busdTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("BUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openLockTokenAndDraw2Call)

        const positionId2 = await positionManager.ownerLastPositionId(bobProxyWallet.address)
        const positionAddress2 = await positionManager.positions(positionId2)

        await bookKeeper.grantRole(await bookKeeper.SHOW_STOPPER_ROLE(), showStopper.address)
        await liquidationEngine.grantRole(await liquidationEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await systemDebtEngine.grantRole(await systemDebtEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await priceOracle.grantRole(await priceOracle.SHOW_STOPPER_ROLE(), showStopper.address)

        await showStopper["cage()"]()

        await showStopper["cage(bytes32)"](formatBytes32String("BUSD"))

        // accumulate bad debt posiion #1
        await showStopper.accumulateBadDebt(formatBytes32String("BUSD"), positionAddress)
        const position1 = await bookKeeper.positions(formatBytes32String("BUSD"), positionAddress)
        expect(position1.lockedCollateral).to.be.equal(WeiPerWad.mul(5))
        expect(position1.debtShare).to.be.equal(0)
        expect(await bookKeeper.collateralToken(formatBytes32String("BUSD"), showStopper.address)).to.be.equal(
          WeiPerWad.mul(5)
        )
        expect(await bookKeeper.systemBadDebt(systemDebtEngine.address)).to.be.equal(WeiPerRad.mul(5))

        // accumulate bad debt posiion #2
        await showStopper.accumulateBadDebt(formatBytes32String("BUSD"), positionAddress2)
        const position2 = await bookKeeper.positions(formatBytes32String("BUSD"), positionAddress2)
        expect(position2.lockedCollateral).to.be.equal(WeiPerWad.mul(5))
        expect(position2.debtShare).to.be.equal(0)
        expect(await bookKeeper.collateralToken(formatBytes32String("BUSD"), showStopper.address)).to.be.equal(
          WeiPerWad.mul(10)
        )
        expect(await bookKeeper.systemBadDebt(systemDebtEngine.address)).to.be.equal(WeiPerRad.mul(10))

        // finalize debt
        await showStopper.finalizeDebt()
        // total debt
        expect(await showStopper.debt()).to.be.equal(WeiPerRad.mul(10))

        // finalize cash price
        await showStopper.finalizeCashPrice(formatBytes32String("BUSD"))
        // badDebtAccumulator / totalDebt = 10000000000000000000000000000000000000000000000 / 10000000000000000000 = 1000000000000000000000000000
        expect(await showStopper.finalCashPrice(formatBytes32String("BUSD"))).to.be.equal(WeiPerRay)
      })
    })
  })
  describe("#accumulateStablecoin, #redeemStablecoin", () => {
    context("when redeem stablecoin", () => {
      it("should be able to accumulateStablecoin, redeemStablecoin", async () => {
        // alice's position #1
        //  a. open a new position
        //  b. lock BUSD
        //  c. mint AUSD
        const openLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "openLockTokenAndDraw",
          [
            positionManager.address,
            stabilityFeeCollector.address,
            busdTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("BUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openLockTokenAndDrawCall)

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        // bob's position #2
        //  a. open a new position
        //  b. lock BUSD
        //  c. mint AUSD
        const openLockTokenAndDraw2Call = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "openLockTokenAndDraw",
          [
            positionManager.address,
            stabilityFeeCollector.address,
            busdTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("BUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openLockTokenAndDraw2Call)

        const positionId2 = await positionManager.ownerLastPositionId(bobProxyWallet.address)
        const positionAddress2 = await positionManager.positions(positionId2)

        // bob's position #3
        //  a. open a new position
        //  b. lock USDT
        //  c. mint AUSD
        const openLockTokenAndDraw3Call = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "openLockTokenAndDraw",
          [
            positionManager.address,
            stabilityFeeCollector.address,
            usdtTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("USDT"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]),
          ]
        )
        await bobProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openLockTokenAndDraw3Call)

        const positionId3 = await positionManager.ownerLastPositionId(bobProxyWallet.address)
        const positionAddress3 = await positionManager.positions(positionId3)

        await bookKeeper.grantRole(await bookKeeper.SHOW_STOPPER_ROLE(), showStopper.address)
        await liquidationEngine.grantRole(await liquidationEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await systemDebtEngine.grantRole(await systemDebtEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await priceOracle.grantRole(await priceOracle.SHOW_STOPPER_ROLE(), showStopper.address)

        await showStopper["cage()"]()

        await showStopper["cage(bytes32)"](formatBytes32String("BUSD"))
        await showStopper["cage(bytes32)"](formatBytes32String("USDT"))

        // accumulate bad debt posiion #1
        await showStopper.accumulateBadDebt(formatBytes32String("BUSD"), positionAddress)
        const position1 = await bookKeeper.positions(formatBytes32String("BUSD"), positionAddress)
        expect(position1.lockedCollateral).to.be.equal(WeiPerWad.mul(5))
        expect(position1.debtShare).to.be.equal(0)
        expect(await bookKeeper.collateralToken(formatBytes32String("BUSD"), showStopper.address)).to.be.equal(
          WeiPerWad.mul(5)
        )
        expect(await bookKeeper.systemBadDebt(systemDebtEngine.address)).to.be.equal(WeiPerRad.mul(5))

        // accumulate bad debt posiion #2
        await showStopper.accumulateBadDebt(formatBytes32String("BUSD"), positionAddress2)
        const position2 = await bookKeeper.positions(formatBytes32String("BUSD"), positionAddress2)
        expect(position2.lockedCollateral).to.be.equal(WeiPerWad.mul(5))
        expect(position2.debtShare).to.be.equal(0)
        expect(await bookKeeper.collateralToken(formatBytes32String("BUSD"), showStopper.address)).to.be.equal(
          WeiPerWad.mul(10)
        )
        expect(await bookKeeper.systemBadDebt(systemDebtEngine.address)).to.be.equal(WeiPerRad.mul(10))

        // accumulate bad debt posiion #3
        await showStopper.accumulateBadDebt(formatBytes32String("USDT"), positionAddress3)
        const position3 = await bookKeeper.positions(formatBytes32String("USDT"), positionAddress3)
        expect(position3.lockedCollateral).to.be.equal(WeiPerWad.mul(5))
        expect(position3.debtShare).to.be.equal(0)
        expect(await bookKeeper.collateralToken(formatBytes32String("USDT"), showStopper.address)).to.be.equal(
          WeiPerWad.mul(5)
        )
        expect(await bookKeeper.systemBadDebt(systemDebtEngine.address)).to.be.equal(WeiPerRad.mul(15))

        // finalize debt
        await showStopper.finalizeDebt()
        expect(await showStopper.debt()).to.be.equal(WeiPerRad.mul(15))

        // finalize cash price BUSD
        await showStopper.finalizeCashPrice(formatBytes32String("BUSD"))
        // badDebtAccumulator / totalDebt = 10000000000000000000000000000000000000000000000 / 15000000000000000000 = 666666666666666666666666666
        expect(await showStopper.finalCashPrice(formatBytes32String("BUSD"))).to.be.equal("666666666666666666666666666")
        // finalize cash price USDT
        await showStopper.finalizeCashPrice(formatBytes32String("USDT"))
        // badDebtAccumulator / totalDebt = 5000000000000000000000000000000000000000000000 / 15000000000000000000 = 333333333333333333333333333
        expect(await showStopper.finalCashPrice(formatBytes32String("USDT"))).to.be.equal("333333333333333333333333333")

        // accumulate stablecoin
        await stablecoinAdapterAsAlice.deposit(
          aliceAddress,
          WeiPerWad.mul(5),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        await bookKeeperAsAlice.whitelist(showStopper.address)

        await showStopperAsAlice.accumulateStablecoin(WeiPerWad.mul(5))

        // redeem stablecoin
        await showStopperAsAlice.redeemStablecoin(formatBytes32String("BUSD"), WeiPerWad.mul(5))
        // WAD(5000000000000000000 * 666666666666666666666666666) = 3333333333333333333
        expect(await bookKeeper.collateralToken(formatBytes32String("BUSD"), aliceAddress)).to.be.equal(
          "3333333333333333333"
        )
        await showStopperAsAlice.redeemStablecoin(formatBytes32String("USDT"), WeiPerWad.mul(5))
        // WAD(5000000000000000000 * 333333333333333333333333333) = 3333333333333333333
        expect(await bookKeeper.collateralToken(formatBytes32String("USDT"), aliceAddress)).to.be.equal(
          "1666666666666666666"
        )

        // over redeem stablecoin
        await expect(
          showStopperAsAlice.redeemStablecoin(formatBytes32String("USDT"), WeiPerWad.mul(5))
        ).to.be.revertedWith("ShowStopper/insufficient-stablecoin-accumulator-balance")
      })
    })
  })
})
