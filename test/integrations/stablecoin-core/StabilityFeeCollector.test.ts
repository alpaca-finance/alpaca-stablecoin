import { ethers, upgrades, waffle } from "hardhat"
import { BigNumber, Contract, ContractReceipt, Event, EventFilter, Signer } from "ethers"

import {
  ProxyWallet,
  PositionManager__factory,
  BookKeeper,
  BookKeeper__factory,
  PositionManager,
  AlpacaStablecoinProxyActions,
  AlpacaStablecoinProxyActions__factory,
  IbTokenAdapter__factory,
  BEP20__factory,
  AlpacaToken__factory,
  FairLaunch__factory,
  Shield__factory,
  IbTokenAdapter,
  BEP20,
  StabilityFeeCollector,
  StabilityFeeCollector__factory,
  AlpacaStablecoin__factory,
  AlpacaStablecoin,
  StablecoinAdapter__factory,
  StablecoinAdapter,
  TokenAdapter__factory,
  TokenAdapter,
  AccessControlConfig__factory,
  AccessControlConfig,
  CollateralPoolConfig,
  CollateralPoolConfig__factory,
  SimplePriceFeed,
  SimplePriceFeed__factory,
  ShowStopper__factory,
  ShowStopper,
  SystemDebtEngine,
  SystemDebtEngine__factory,
} from "../../../typechain"
import { expect } from "chai"
import { loadProxyWalletFixtureHandler } from "../../helper/proxy"
import { formatBytes32String, parseEther, parseUnits } from "ethers/lib/utils"
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
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"

import * as TimeHelpers from "../../helper/time"
import * as AssertHelpers from "../../helper/assert"
import { AddressZero } from "../../helper/address"

type Fixture = {
  positionManager: PositionManager
  alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  bookKeeper: BookKeeper
  stabilityFeeCollector: StabilityFeeCollector
  tokenAdapter: TokenAdapter
  stablecoinAdapter: StablecoinAdapter
  busd: BEP20
  alpacaStablecoin: AlpacaStablecoin
  collateralPoolConfig: CollateralPoolConfig
}

const CLOSE_FACTOR_BPS = BigNumber.from(5000)
const LIQUIDATOR_INCENTIVE_BPS = BigNumber.from(12500)
const TREASURY_FEE_BPS = BigNumber.from(2500)

const loadFixtureHandler = async (): Promise<Fixture> => {
  const [deployer, alice, , dev] = await ethers.getSigners()

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

  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const busd = await BEP20.deploy("BUSD", "BUSD")
  await busd.deployed()
  await busd.mint(await deployer.getAddress(), ethers.utils.parseEther("100"))
  await busd.mint(await alice.getAddress(), ethers.utils.parseEther("100"))

  // Deploy AlpacaStablecoin
  const AlpacaStablecoin = new AlpacaStablecoin__factory(deployer)
  const alpacaStablecoin = (await upgrades.deployProxy(AlpacaStablecoin, ["Alpaca USD", "AUSD"])) as AlpacaStablecoin

  const BookKeeper = new BookKeeper__factory(deployer)
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [
    collateralPoolConfig.address,
    accessControlConfig.address,
  ])) as BookKeeper

  await accessControlConfig.grantRole(await accessControlConfig.BOOK_KEEPER_ROLE(), bookKeeper.address)

  await accessControlConfig.grantRole(await accessControlConfig.PRICE_ORACLE_ROLE(), deployer.address)

  const ShowStopper = new ShowStopper__factory(deployer)
  const showStopper = (await upgrades.deployProxy(ShowStopper, [bookKeeper.address])) as ShowStopper

  const PositionManager = new PositionManager__factory(deployer)
  const positionManager = (await upgrades.deployProxy(PositionManager, [
    bookKeeper.address,
    showStopper.address,
  ])) as PositionManager

  const AlpacaStablecoinProxyActions = new AlpacaStablecoinProxyActions__factory(deployer)
  const alpacaStablecoinProxyActions = await AlpacaStablecoinProxyActions.deploy()

  const BUSDTokenAdapter = new TokenAdapter__factory(deployer)
  const busdTokenAdapter = (await upgrades.deployProxy(BUSDTokenAdapter, [
    bookKeeper.address,
    formatBytes32String("BUSD"),
    busd.address,
  ])) as TokenAdapter

  const StablecoinAdapter = new StablecoinAdapter__factory(deployer)
  const stablecoinAdapter = (await upgrades.deployProxy(StablecoinAdapter, [
    bookKeeper.address,
    alpacaStablecoin.address,
  ])) as StablecoinAdapter

  const SystemDebtEngine = (await ethers.getContractFactory("SystemDebtEngine", deployer)) as SystemDebtEngine__factory
  const systemDebtEngine = (await upgrades.deployProxy(SystemDebtEngine, [bookKeeper.address])) as SystemDebtEngine

  // Deploy StabilityFeeCollector
  const StabilityFeeCollector = new StabilityFeeCollector__factory(deployer)
  const stabilityFeeCollector = (await upgrades.deployProxy(StabilityFeeCollector, [
    bookKeeper.address,
    systemDebtEngine.address,
  ])) as StabilityFeeCollector

  await stabilityFeeCollector.setSystemDebtEngine(await dev.getAddress())

  await accessControlConfig.grantRole(
    ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]),
    busdTokenAdapter.address
  )
  await accessControlConfig.grantRole(
    ethers.utils.solidityKeccak256(["string"], ["POSITION_MANAGER_ROLE"]),
    positionManager.address
  )
  await accessControlConfig.grantRole(
    ethers.utils.solidityKeccak256(["string"], ["STABILITY_FEE_COLLECTOR_ROLE"]),
    stabilityFeeCollector.address
  )

  await alpacaStablecoin.grantRole(await alpacaStablecoin.MINTER_ROLE(), stablecoinAdapter.address)

  const SimplePriceFeed = (await ethers.getContractFactory("SimplePriceFeed", deployer)) as SimplePriceFeed__factory
  const simplePriceFeed = (await upgrades.deployProxy(SimplePriceFeed, [
    accessControlConfig.address,
  ])) as SimplePriceFeed
  await simplePriceFeed.deployed()

  // Deploy TokenAdapter
  const TokenAdapter = (await ethers.getContractFactory("TokenAdapter", deployer)) as TokenAdapter__factory
  const tokenAdapter = (await upgrades.deployProxy(TokenAdapter, [
    bookKeeper.address,
    formatBytes32String("BTCB"),
    busd.address,
  ])) as TokenAdapter
  await tokenAdapter.deployed()

  await collateralPoolConfig.initCollateralPool(
    formatBytes32String("BUSD"),
    // set pool debt ceiling 100 rad
    WeiPerRad.mul(100),
    // set position debt floor 1 rad
    WeiPerRad.mul(1),
    simplePriceFeed.address,
    WeiPerRay,
    WeiPerRay,
    tokenAdapter.address,
    CLOSE_FACTOR_BPS,
    LIQUIDATOR_INCENTIVE_BPS,
    TREASURY_FEE_BPS,
    AddressZero
  )

  await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BUSD"), WeiPerRay)

  // set total debt ceiling 100 rad
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(100))

  return {
    alpacaStablecoinProxyActions,
    positionManager,
    bookKeeper,
    stabilityFeeCollector,
    tokenAdapter: busdTokenAdapter,
    stablecoinAdapter,
    busd,
    alpacaStablecoin,
    collateralPoolConfig,
  }
}

describe("Stability Fee", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer
  let dev: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string
  let devAddress: string

  // Proxy wallet
  let deployerProxyWallet: ProxyWallet
  let aliceProxyWallet: ProxyWallet
  let bobProxyWallet: ProxyWallet

  // Contract
  let positionManager: PositionManager
  let alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  let alpacaStablecoinProxyActionsAsAlice: AlpacaStablecoinProxyActions
  let bookKeeper: BookKeeper
  let tokenAdapter: TokenAdapter
  let stablecoinAdapter: StablecoinAdapter
  let busd: BEP20
  let stabilityFeeCollector: StabilityFeeCollector
  let alpacaStablecoin: AlpacaStablecoin
  let collateralPoolConfig: CollateralPoolConfig

  beforeEach(async () => {
    ;[deployer, alice, , dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      dev.getAddress(),
    ])
    ;({
      proxyWallets: [deployerProxyWallet, aliceProxyWallet, bobProxyWallet],
    } = await loadProxyWalletFixtureHandler())
    ;({
      alpacaStablecoinProxyActions,
      positionManager,
      bookKeeper,
      tokenAdapter,
      stablecoinAdapter,
      busd,
      stabilityFeeCollector,
      alpacaStablecoin,
      collateralPoolConfig,
    } = await loadFixtureHandler())

    const busdTokenAsAlice = BEP20__factory.connect(busd.address, alice)
    const alpacaStablecoinAsAlice = Vault__factory.connect(alpacaStablecoin.address, alice)

    alpacaStablecoinProxyActionsAsAlice = AlpacaStablecoinProxyActions__factory.connect(
      alpacaStablecoinProxyActions.address,
      alice
    )

    await busdTokenAsAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
    await alpacaStablecoinAsAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
  })
  describe("#collect", () => {
    context("when call collect directly and call deposit", () => {
      it("should be success", async () => {
        // set stability fee rate 20% per year
        await collateralPoolConfig.setStabilityFeeRate(
          formatBytes32String("BUSD"),
          BigNumber.from("1000000005781378656804591713")
        )

        // time increase 6 month
        await TimeHelpers.increase(TimeHelpers.duration.seconds(ethers.BigNumber.from("15768000")))
        await stabilityFeeCollector.collect(formatBytes32String("BUSD"))

        // debtAccumulatedRate = RAY(1000000005781378656804591713^15768000) = 1095445115010332226911367294
        AssertHelpers.assertAlmostEqual(
          (await collateralPoolConfig.collateralPools(formatBytes32String("BUSD"))).debtAccumulatedRate.toString(),
          "1095445115010332226911367294"
        )
        AssertHelpers.assertAlmostEqual((await bookKeeper.stablecoin(devAddress)).toString(), "0")

        // position 1
        //  a. open a new position
        //  b. lock ibBUSD
        //  c. mint AUSD
        const openLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "openLockTokenAndDraw",
          [
            positionManager.address,
            stabilityFeeCollector.address,
            tokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("BUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const openLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          openLockTokenAndDrawCall
        )
        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        // position debtShare = 5000000000000000000000000000000000000000000000 / 1095445115010332226911367294 = 4564354645876384278
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.positions(formatBytes32String("BUSD"), positionAddress)).debtShare.toString(),
          "4564354645876384278"
        )
        AssertHelpers.assertAlmostEqual(
          (await collateralPoolConfig.collateralPools(formatBytes32String("BUSD"))).totalDebtShare.toString(),
          "4564354645876384278"
        )
        AssertHelpers.assertAlmostEqual(
          (await collateralPoolConfig.collateralPools(formatBytes32String("BUSD"))).debtAccumulatedRate.toString(),
          "1095445115010332226911367294"
        )

        // time increase 1 year
        await TimeHelpers.increase(TimeHelpers.duration.seconds(ethers.BigNumber.from("31536000")))

        // position 2
        //  a. open a new position
        //  b. lock ibBUSD
        //  c. mint AUSD
        const openLockTokenAndDraw2Call = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "openLockTokenAndDraw",
          [
            positionManager.address,
            stabilityFeeCollector.address,
            tokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("BUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const openLockTokenAndDraw2Tx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          openLockTokenAndDrawCall
        )
        const positionId2 = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress2 = await positionManager.positions(positionId2)

        // debtAccumulatedRate = RAY((1000000005781378656804591713^31536000) * 1095445115010332226911367294) = 1314534138012398672287467301
        AssertHelpers.assertAlmostEqual(
          (await collateralPoolConfig.collateralPools(formatBytes32String("BUSD"))).debtAccumulatedRate.toString(),
          "1314534138012398672287467301"
        )
        // debtShare * diffDebtAccumulatedRate =  4564354645876384278 * (1314534138012398672287467301 - 1095445115010332226911367294) = 999999999999999999792432233173942358090489946
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.stablecoin(devAddress)).toString(),
          "999999999999999999792432233173942358090489946"
        )

        // position debtShare = 5000000000000000000000000000000000000000000000 / 1314534138012398672287467301 = 3803628871563653565
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.positions(formatBytes32String("BUSD"), positionAddress2)).debtShare.toString(),
          "3803628871563653565"
        )
        // 4564354645876384278 + 3803628871563653565 = 8367983517440037843
        AssertHelpers.assertAlmostEqual(
          (await collateralPoolConfig.collateralPools(formatBytes32String("BUSD"))).totalDebtShare.toString(),
          "8367983517440037843"
        )

        // time increase 1 year
        await TimeHelpers.increase(TimeHelpers.duration.seconds(ethers.BigNumber.from("31536000")))

        // debtAccumulatedRate ~ 20%
        await stabilityFeeCollector.collect(formatBytes32String("BUSD"))

        // debtAccumulatedRate = RAY((1000000005781378656804591713^31536000) * 1314534138012398672287467301) = 1577440965614878406737552619
        AssertHelpers.assertAlmostEqual(
          (await collateralPoolConfig.collateralPools(formatBytes32String("BUSD"))).debtAccumulatedRate.toString(),
          "1577440965614878406737552619"
        )
        // debtShare * diffDebtAccumulatedRate =  8367983517440037843 * (1577440965614878406737552619 - 1314534138012398672287467301) = 2199999999999999999533019044066331740498689074
        // 2199999999999999999533019044066331740498689074 + 999999999999999999792432233173942358090489946 = 3199999999999999999325451277240274098589179020
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.stablecoin(devAddress)).toString(),
          "3199999999999999999325451277240274098589179020"
        )

        //  a. repay some AUSD
        //  b. alice unlock some ibBUSD
        //  c. convert BUSD to ibBUSD
        const wipeAndUnlockTokenCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipeAndUnlockToken", [
          positionManager.address,
          tokenAdapter.address,
          stablecoinAdapter.address,
          positionId,
          WeiPerWad.mul(1),
          WeiPerWad.mul(1),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        const wipeAndUnlockTokenTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          wipeAndUnlockTokenCall
        )

        AssertHelpers.assertAlmostEqual(
          (await collateralPoolConfig.collateralPools(formatBytes32String("BUSD"))).debtAccumulatedRate.toString(),
          "1577440965614878406737552619"
        )
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.stablecoin(devAddress)).toString(),
          "3199999999999999999325451277240274098589179020"
        )
      })
    })
  })
})
