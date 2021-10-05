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
} from "../../../typechain"
import { expect } from "chai"
import { loadProxyWalletFixtureHandler } from "../../helper/proxy"
import { formatBytes32String } from "ethers/lib/utils"
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

type Fixture = {
  positionManager: PositionManager
  alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  bookKeeper: BookKeeper
  stabilityFeeCollector: StabilityFeeCollector
  tokenAdapter: TokenAdapter
  stablecoinAdapter: StablecoinAdapter
  busd: BEP20
  alpacaStablecoin: AlpacaStablecoin
}

const loadFixtureHandler = async (): Promise<Fixture> => {
  const [deployer, alice, , dev] = await ethers.getSigners()

  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const busd = await BEP20.deploy("BUSD", "BUSD")
  await busd.deployed()
  await busd.mint(await deployer.getAddress(), ethers.utils.parseEther("100"))
  await busd.mint(await alice.getAddress(), ethers.utils.parseEther("100"))

  // Deploy AlpacaStablecoin
  const AlpacaStablecoin = new AlpacaStablecoin__factory(deployer)
  const alpacaStablecoin = await AlpacaStablecoin.deploy("Alpaca USD", "AUSD", "31337")

  const BookKeeper = new BookKeeper__factory(deployer)
  const bookKeeper = (await upgrades.deployProxy(BookKeeper)) as BookKeeper

  await bookKeeper.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployer.address)

  await bookKeeper.init(formatBytes32String("BUSD"))
  // set pool debt ceiling 100 rad
  await bookKeeper.setDebtCeiling(formatBytes32String("BUSD"), WeiPerRad.mul(100))
  // set price with safety margin 1 ray
  await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BUSD"), WeiPerRay)
  // set position debt floor 1 rad
  await bookKeeper.setDebtFloor(formatBytes32String("BUSD"), WeiPerRad.mul(1))
  // set total debt ceiling 100 rad
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(100))

  const PositionManager = new PositionManager__factory(deployer)
  const positionManager = (await upgrades.deployProxy(PositionManager, [bookKeeper.address])) as PositionManager

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

  // Deploy StabilityFeeCollector
  const StabilityFeeCollector = new StabilityFeeCollector__factory(deployer)
  const stabilityFeeCollector = (await upgrades.deployProxy(StabilityFeeCollector, [
    bookKeeper.address,
  ])) as StabilityFeeCollector

  await stabilityFeeCollector.init(formatBytes32String("ibBUSD"))

  await bookKeeper.grantRole(ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]), busdTokenAdapter.address)
  await bookKeeper.grantRole(
    ethers.utils.solidityKeccak256(["string"], ["POSITION_MANAGER_ROLE"]),
    positionManager.address
  )
  await bookKeeper.grantRole(
    ethers.utils.solidityKeccak256(["string"], ["STABILITY_FEE_COLLECTOR_ROLE"]),
    stabilityFeeCollector.address
  )

  await alpacaStablecoin.grantRole(await alpacaStablecoin.MINTER_ROLE(), stablecoinAdapter.address)

  return {
    alpacaStablecoinProxyActions,
    positionManager,
    bookKeeper,
    stabilityFeeCollector,
    tokenAdapter: busdTokenAdapter,
    stablecoinAdapter,
    busd,
    alpacaStablecoin,
  }
}

describe("Stability Fee", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string

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

  beforeEach(async () => {
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])
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
  //   describe("user mint AUSD and repay AUSD (fee 20%)", () => {
  //     context("alice mint AUSD and repay AUSD", () => {
  //       it("should be able to mint and repay", async () => {
  //         // set stability fee rate 20% per year
  //         await stabilityFeeCollector.setStabilityFeeRate(
  //           formatBytes32String("ibBUSD"),
  //           BigNumber.from("1000000005781378656804591713")
  //         )

  //         // 1.
  //         //  a. convert BUSD to ibBUSD
  //         //  b. open a new position
  //         //  c. lock ibBUSD
  //         //  d. mint AUSD
  //         const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
  //           "convertOpenLockTokenAndDraw",
  //           [
  //             vault.address,
  //             positionManager.address,
  //             stabilityFeeCollector.address,
  //             ibTokenAdapter.address,
  //             stablecoinAdapter.address,
  //             formatBytes32String("ibBUSD"),
  //             WeiPerWad.mul(10),
  //             WeiPerWad.mul(5),
  //             true,
  //             ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
  //           ]
  //         )
  //         const convertOpenLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
  //           alpacaStablecoinProxyActions.address,
  //           convertOpenLockTokenAndDrawCall
  //         )

  //         const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
  //         const positionAddress = await positionManager.positions(positionId)

  //         const [, debtAccumulatedRateBefore] = await bookKeeper["collateralPools(bytes32)"](
  //           formatBytes32String("ibBUSD")
  //         )

  //         // time increase 1 year
  //         await TimeHelpers.increase(TimeHelpers.duration.seconds(ethers.BigNumber.from("31536000")))

  //         // debtAccumulatedRate ~ 20%
  //         await stabilityFeeCollector.collect(formatBytes32String("ibBUSD"))

  //         const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)

  //         const baseTokenBefore = await baseToken.balanceOf(aliceAddress)

  //         const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
  //           formatBytes32String("ibBUSD"),
  //           positionAddress
  //         )

  //         const [, debtAccumulatedRateAfter] = await bookKeeper["collateralPools(bytes32)"](formatBytes32String("ibBUSD"))

  //         // 2.
  //         //  a. repay some AUSD
  //         //  b. alice unlock some ibBUSD
  //         //  c. convert BUSD to ibBUSD
  //         const wipeUnlockTokenAndConvertCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
  //           "wipeUnlockTokenAndConvert",
  //           [
  //             vault.address,
  //             positionManager.address,
  //             ibTokenAdapter.address,
  //             stablecoinAdapter.address,
  //             positionId,
  //             WeiPerWad.mul(1),
  //             WeiPerWad.mul(1),
  //             ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
  //           ]
  //         )
  //         const wipeUnlockTokenAndConvertTx = await aliceProxyWallet["execute(address,bytes)"](
  //           alpacaStablecoinProxyActions.address,
  //           wipeUnlockTokenAndConvertCall
  //         )

  //         const alpacaStablecoinAfter = await alpacaStablecoin.balanceOf(aliceAddress)

  //         const baseTokenAfter = await baseToken.balanceOf(aliceAddress)

  //         const [lockedCollateralAfter, debtShareAfter] = await bookKeeper.positions(
  //           formatBytes32String("ibBUSD"),
  //           positionAddress
  //         )

  //         expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfter)).to.be.equal(WeiPerWad.mul(1))
  //         expect(baseTokenAfter.sub(baseTokenBefore)).to.be.equal(WeiPerWad.mul(1))
  //         expect(lockedCollateralBefore.sub(lockedCollateralAfter)).to.be.equal(WeiPerWad.mul(1))
  //         // debtShareToRepay = 1 rad / 1.2 ray = 0.833333333333333333 wad
  //         AssertHelpers.assertAlmostEqual(debtShareBefore.sub(debtShareAfter).toString(), "833333333333333333")
  //       })
  //     })
  //   })
})
