import { ethers, network, upgrades, waffle } from "hardhat"
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
import { formatBytes32String, parseEther, parseUnits } from "ethers/lib/utils"
import { expectEmit, getEvent } from "../../helper/event"
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
  ibTokenAdapter: IbTokenAdapter
  wbnbTokenAdapter: TokenAdapter
  stablecoinAdapter: StablecoinAdapter
  vault: Vault
  baseToken: BEP20
  alpacaStablecoin: AlpacaStablecoin
}

const loadFixtureHandler = async (): Promise<Fixture> => {
  const [deployer, alice, , dev] = await ethers.getSigners()

  // alpca vault
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
  const ibDUMMY = await BEP20.deploy("ibDUMMY", "ibDUMMY")
  await ibDUMMY.deployed()

  const baseToken = await BEP20.deploy("BTOKEN", "BTOKEN")
  await baseToken.deployed()
  await baseToken.mint(await deployer.getAddress(), ethers.utils.parseEther("100"))
  await baseToken.mint(await alice.getAddress(), ethers.utils.parseEther("100"))

  const DebtToken = new DebtToken__factory(deployer)
  const debtToken = await DebtToken.deploy()
  await debtToken.deployed()
  await debtToken.initialize("debtibBTOKEN_V2", "debtibBTOKEN_V2", deployer.address)

  // Setup FairLaunch contract
  // Deploy ALPACAs
  const AlpacaToken = new AlpacaToken__factory(deployer)
  const alpacaToken = await AlpacaToken.deploy(132, 137)
  await alpacaToken.deployed()

  const FairLaunch = new FairLaunch__factory(deployer)
  const fairLaunch = await FairLaunch.deploy(
    alpacaToken.address,
    deployer.address,
    ALPACA_REWARD_PER_BLOCK,
    0,
    ALPACA_BONUS_LOCK_UP_BPS,
    0
  )
  await fairLaunch.deployed()

  const Shield = (await ethers.getContractFactory("Shield", deployer)) as Shield__factory
  const shield = await Shield.deploy(deployer.address, fairLaunch.address)
  await shield.deployed()

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

  // Config Alpaca's FairLaunch
  // Assuming Deployer is timelock for easy testing
  await fairLaunch.addPool(1, busdVault.address, true)
  await fairLaunch.transferOwnership(shield.address)
  await shield.transferOwnership(await deployer.getAddress())
  await alpacaToken.transferOwnership(fairLaunch.address)

  // Deploy AlpacaStablecoin
  const AlpacaStablecoin = new AlpacaStablecoin__factory(deployer)
  const alpacaStablecoin = await AlpacaStablecoin.deploy("Alpaca USD", "AUSD", "31337")

  const BookKeeper = new BookKeeper__factory(deployer)
  const bookKeeper = (await upgrades.deployProxy(BookKeeper)) as BookKeeper

  await bookKeeper.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployer.address)

  // init ibBUSD pool
  await bookKeeper.init(formatBytes32String("ibBUSD"))
  // set pool debt ceiling 100 rad
  await bookKeeper.setDebtCeiling(formatBytes32String("ibBUSD"), WeiPerRad.mul(100))
  // set price with safety margin 1 ray (1 ibBUSD = 1 USD)
  await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("ibBUSD"), WeiPerRay)
  // set position debt floor 1 rad
  await bookKeeper.setDebtFloor(formatBytes32String("ibBUSD"), WeiPerRad.mul(1))
  // set total debt ceiling 10000 rad
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10000))

  // init WBNB pool
  await bookKeeper.init(formatBytes32String("WBNB"))
  // set pool debt ceiling 1000 rad
  await bookKeeper.setDebtCeiling(formatBytes32String("WBNB"), WeiPerRad.mul(1000))
  // set price with safety margin 400 ray (1 BNB = 400 USD)
  await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("WBNB"), WeiPerRay.mul(400))
  // set position debt floor 1 rad
  await bookKeeper.setDebtFloor(formatBytes32String("WBNB"), WeiPerRad.mul(1))

  const PositionManager = new PositionManager__factory(deployer)
  const positionManager = (await upgrades.deployProxy(PositionManager, [bookKeeper.address])) as PositionManager

  const AlpacaStablecoinProxyActions = new AlpacaStablecoinProxyActions__factory(deployer)
  const alpacaStablecoinProxyActions = await AlpacaStablecoinProxyActions.deploy()

  const IbTokenAdapter = (await ethers.getContractFactory("IbTokenAdapter", deployer)) as IbTokenAdapter__factory
  const ibTokenAdapter = (await upgrades.deployProxy(IbTokenAdapter, [
    bookKeeper.address,
    formatBytes32String("ibBUSD"),
    busdVault.address,
    alpacaToken.address,
    fairLaunch.address,
    0,
    shield.address,
    await deployer.getAddress(),
    BigNumber.from(1000),
    await dev.getAddress(),
  ])) as IbTokenAdapter

  const WBNBTokenAdapter = new TokenAdapter__factory(deployer)
  const wbnbTokenAdapter = (await upgrades.deployProxy(WBNBTokenAdapter, [
    bookKeeper.address,
    formatBytes32String("WBNB"),
    wbnb.address,
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
  await stabilityFeeCollector.init(formatBytes32String("WBNB"))

  await bookKeeper.grantRole(ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]), ibTokenAdapter.address)
  await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), wbnbTokenAdapter.address)
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
    ibTokenAdapter,
    wbnbTokenAdapter,
    stablecoinAdapter,
    vault: busdVault,
    baseToken,
    alpacaStablecoin,
  }
}

describe("position manager", () => {
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
  let ibTokenAdapter: IbTokenAdapter
  let wbnbTokenAdapter: TokenAdapter
  let stablecoinAdapter: StablecoinAdapter
  let vault: Vault
  let baseToken: BEP20
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
      ibTokenAdapter,
      wbnbTokenAdapter,
      stablecoinAdapter,
      vault,
      baseToken,
      stabilityFeeCollector,
      alpacaStablecoin,
    } = await loadFixtureHandler())

    const baseTokenAsAlice = BEP20__factory.connect(baseToken.address, alice)
    const vaultAsAlice = Vault__factory.connect(vault.address, alice)
    const alpacaStablecoinAsAlice = Vault__factory.connect(alpacaStablecoin.address, alice)

    alpacaStablecoinProxyActionsAsAlice = AlpacaStablecoinProxyActions__factory.connect(
      alpacaStablecoinProxyActions.address,
      alice
    )

    await baseTokenAsAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
    await vaultAsAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
    await alpacaStablecoinAsAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
  })
  describe("user opens a new position", () => {
    context("alice opens a new position", () => {
      it("alice should be able to open a position", async () => {
        // 1. alice open a new position
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("open", [
          positionManager.address,
          formatBytes32String("ibBUSD"),
          aliceProxyWallet.address,
        ])
        const tx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          openPositionCall
        )
        const txReceipt = await tx.wait()

        const event = await getEvent(positionManager, txReceipt.blockNumber, "NewPosition")
        expectEmit(event, aliceProxyWallet.address, aliceProxyWallet.address, 1)

        expect(await positionManager.ownerLastPositionId(aliceProxyWallet.address)).to.be.equal(1)
      })
    })
  })
  describe("user opens a new position and convert token to ibToken and lock ibToken and mint AUSD in separated transactions", () => {
    context("alice doesn't have collateral token", () => {
      it("should be revert", async () => {
        // 1. alice open a new position
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("open", [
          positionManager.address,
          formatBytes32String("ibBUSD"),
          aliceProxyWallet.address,
        ])
        const openTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          openPositionCall
        )

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        // 2. alice lock collateral
        const lockCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("lockToken", [
          positionManager.address,
          ibTokenAdapter.address,
          positionId,
          WeiPerWad.mul(10),
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        expect(
          aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, lockCall)
        ).to.be.revertedWith("!safeTransferFrom")
      })
    })
    context("alice mint AUSD over a lock collateral value", () => {
      it("should be revert", async () => {
        // 1. alice open a new position
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("open", [
          positionManager.address,
          formatBytes32String("ibBUSD"),
          aliceProxyWallet.address,
        ])
        const openTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          openPositionCall
        )

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)
        // 2. alice convert BUSD to ibBUSD
        const convertCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("tokenToIbToken", [
          vault.address,
          WeiPerWad.mul(10),
        ])
        const convertTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertCall
        )

        // 3. alice lock ibBUSD
        const lockCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("lockToken", [
          positionManager.address,
          ibTokenAdapter.address,
          positionId,
          WeiPerWad.mul(10),
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        const lockTx = await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, lockCall)

        // 4. alice mint AUSD
        const drawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("draw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          positionId,
          WeiPerWad.mul(15),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await expect(
          aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, drawCall)
        ).to.be.revertedWith("BookKeeper/not-safe")
      })
    })
    context(
      "alice opens a new position and convert token to ibToken and lock ibToken and mint AUSD in separated transactions",
      () => {
        it("alice should be able to opens a new position and convert token to ibToken and lock ibToken and mint AUSD in separated transactions", async () => {
          // 1. alice open a new position
          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("open", [
            positionManager.address,
            formatBytes32String("ibBUSD"),
            aliceProxyWallet.address,
          ])
          const openTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openPositionCall
          )

          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)

          const baseTokenBefore = await baseToken.balanceOf(aliceAddress)
          const ibTokenBefore = await vault.balanceOf(aliceAddress)

          // 2. alice convert BUSD to ibBUSD
          const convertCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("tokenToIbToken", [
            vault.address,
            WeiPerWad.mul(10),
          ])
          const convertTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            convertCall
          )

          const baseTokenAfter = await baseToken.balanceOf(aliceAddress)
          const ibTokenAfterConvert = await vault.balanceOf(aliceAddress)

          expect(baseTokenBefore.sub(baseTokenAfter)).to.be.equal(WeiPerWad.mul(10))
          expect(ibTokenAfterConvert.sub(ibTokenBefore)).to.be.equal(WeiPerWad.mul(10))

          const [lockedCollateralBefore] = await bookKeeper.positions(formatBytes32String("ibBUSD"), positionAddress)

          // 3. alice lock ibBUSD
          const lockCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("lockToken", [
            positionManager.address,
            ibTokenAdapter.address,
            positionId,
            WeiPerWad.mul(10),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const lockTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            lockCall
          )

          const ibTokenAfterLock = await vault.balanceOf(aliceAddress)
          const [lockedCollateralAfterlock, debtShareAfterlock] = await bookKeeper.positions(
            formatBytes32String("ibBUSD"),
            positionAddress
          )

          expect(ibTokenAfterConvert.sub(ibTokenAfterLock)).to.be.equal(WeiPerWad.mul(10))
          expect(lockedCollateralAfterlock.sub(lockedCollateralBefore)).to.be.equal(WeiPerWad.mul(10))

          const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)

          // 4. alice mint AUSD
          const drawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("draw", [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            WeiPerWad.mul(5),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const drawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            drawCall
          )

          const [lockedCollateralAfterDraw, debtShareAfterDraw] = await bookKeeper.positions(
            formatBytes32String("ibBUSD"),
            positionAddress
          )
          const alpacaStablecoinAfterDraw = await alpacaStablecoin.balanceOf(aliceAddress)

          expect(debtShareAfterDraw.sub(debtShareAfterlock)).to.be.equal(WeiPerWad.mul(5))
          expect(alpacaStablecoinAfterDraw.sub(alpacaStablecoinBefore)).to.be.equal(WeiPerWad.mul(5))
        })
      }
    )
  })
  describe("user opens a new position and convert token to ibToken and lock ibToken and mint AUSD in single transactions", () => {
    context("alice doesn't have collateral token", () => {
      it("should be revert", async () => {
        // 1.
        //  a. open a new position
        //  b. lock ibBUSD
        //  c. mint AUSD
        const openLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "openLockTokenAndDraw",
          [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await expect(
          aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openLockTokenAndDrawCall)
        ).to.be.revertedWith("!safeTransferFrom")
      })
    })
    context("alice mint AUSD over a lock collateral value", () => {
      it("should be revert", async () => {
        // 1.
        //  a. convert BUSD to ibBUSD
        //  b. open a new position
        //  c. lock ibBUSD
        //  d. mint AUSD
        const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(15),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await expect(
          aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            convertOpenLockTokenAndDrawCall
          )
        ).to.be.revertedWith("BookKeeper/not-safe")
      })
    })
    context(
      "alice opens a new position and convert token to ibToken and lock ibToken and mint AUSD in single transactions",
      () => {
        it("alice should be able to opens a new position and convert token to ibToken and lock ibToken and mint AUSD in single transactions", async () => {
          // 1.
          //  a. convert BUSD to ibBUSD
          //  b. open a new position
          //  c. lock ibBUSD
          //  d. mint AUSD
          const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "convertOpenLockTokenAndDraw",
            [
              vault.address,
              positionManager.address,
              stabilityFeeCollector.address,
              ibTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("ibBUSD"),
              WeiPerWad.mul(10),
              WeiPerWad.mul(5),
              true,
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const convertOpenLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            convertOpenLockTokenAndDrawCall
          )

          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)

          const [lockedCollateralAfter, debtShareAfter] = await bookKeeper.positions(
            formatBytes32String("ibBUSD"),
            positionAddress
          )

          const alpacaStablecoinAfter = await alpacaStablecoin.balanceOf(aliceAddress)

          expect(lockedCollateralAfter).to.be.equal(WeiPerWad.mul(10))
          expect(debtShareAfter).to.be.equal(WeiPerWad.mul(5))
          expect(alpacaStablecoinAfter).to.be.equal(WeiPerWad.mul(5))
        })
      }
    )
  })
  describe("user repay some AUSD and unlock ibToken and conver ibToken to token in separated transactions", () => {
    context("alice repay some AUSD and unlock ibToken and conver ibToken to token in separated transactions", () => {
      it("alice should be able to repay some AUSD and unlock ibToken and conver ibToken to token in separated transactions", async () => {
        // 1.
        //  a. convert BUSD to ibBUSD
        //  b. open a new position
        //  c. lock ibBUSD
        //  d. mint AUSD
        const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const convertOpenLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertOpenLockTokenAndDrawCall
        )

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)

        // 2. alice repay some AUSD
        const wipeCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipe", [
          positionManager.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          positionId,
          WeiPerWad.mul(2),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        const wipeTx = await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, wipeCall)

        const [lockedCollateralAfterWipe, debtShareAfterWipe] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const alpacaStablecoinAfterWipe = await alpacaStablecoin.balanceOf(aliceAddress)

        const ibTokenBefore = await vault.balanceOf(aliceAddress)

        expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfterWipe)).to.be.equal(WeiPerWad.mul(2))
        expect(debtShareBefore.sub(debtShareAfterWipe)).to.be.equal(WeiPerWad.mul(2))

        // 3. alice unlock some ibBUSD
        const unlockTokenCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("unlockToken", [
          positionManager.address,
          ibTokenAdapter.address,
          positionId,
          WeiPerWad.mul(2),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        const unlockTokenTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          unlockTokenCall
        )

        const [lockedCollateralAfterUnlock, debtShareAfterUnlock] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const ibTokenAfter = await vault.balanceOf(aliceAddress)

        expect(lockedCollateralAfterWipe.sub(lockedCollateralAfterUnlock)).to.be.equal(WeiPerWad.mul(2))
        expect(ibTokenAfter.sub(ibTokenBefore)).to.be.equal(WeiPerWad.mul(2))

        const baseTokenBefore = await baseToken.balanceOf(aliceAddress)

        // 4. alice convert BUSD to ibBUSD
        const convertCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("ibTokenToToken", [
          vault.address,
          WeiPerWad.mul(2),
        ])
        const convertTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertCall
        )

        const baseTokenAfter = await baseToken.balanceOf(aliceAddress)

        expect(baseTokenAfter.sub(baseTokenBefore)).to.be.equal(WeiPerWad.mul(2))
      })
    })
    context("alice repay AUSD over debt", () => {
      it("alice should be able to repay some AUSD and unlock ibToken and conver ibToken to token in separated transactions", async () => {
        // 1. open 2 position to mint 5 + 5 = 10 AUSD
        //  a. convert BUSD to ibBUSD
        //  b. open a new position
        //  c. lock ibBUSD
        //  d. mint AUSD
        const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const convertOpenLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertOpenLockTokenAndDrawCall
        )
        const convertOpenLockTokenAndDraw2Call = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const convertOpenLockTokenAndDraw2Tx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertOpenLockTokenAndDrawCall
        )

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)

        // 2. alice repay AUSD over debt
        const wipeCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipe", [
          positionManager.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          positionId,
          WeiPerWad.mul(10),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        const wipeTx = await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, wipeCall)

        const [lockedCollateralAfterWipe, debtShareAfterWipe] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const alpacaStablecoinAfterWipe = await alpacaStablecoin.balanceOf(aliceAddress)

        const ibTokenBefore = await vault.balanceOf(aliceAddress)
        expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfterWipe)).to.be.equal(WeiPerWad.mul(10))
        expect(debtShareBefore.sub(debtShareAfterWipe)).to.be.equal(WeiPerWad.mul(5))

        // 3. alice unlock some ibBUSD
        const unlockTokenCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("unlockToken", [
          positionManager.address,
          ibTokenAdapter.address,
          positionId,
          WeiPerWad.mul(10),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        const unlockTokenTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          unlockTokenCall
        )

        const [lockedCollateralAfterUnlock, debtShareAfterUnlock] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const ibTokenAfter = await vault.balanceOf(aliceAddress)

        expect(lockedCollateralAfterWipe.sub(lockedCollateralAfterUnlock)).to.be.equal(WeiPerWad.mul(10))
        expect(ibTokenAfter.sub(ibTokenBefore)).to.be.equal(WeiPerWad.mul(10))

        const baseTokenBefore = await baseToken.balanceOf(aliceAddress)

        // 4. alice convert BUSD to ibBUSD
        const convertCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("ibTokenToToken", [
          vault.address,
          WeiPerWad.mul(10),
        ])
        const convertTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertCall
        )

        const baseTokenAfter = await baseToken.balanceOf(aliceAddress)

        expect(baseTokenAfter.sub(baseTokenBefore)).to.be.equal(WeiPerWad.mul(10))
      })
    })
    context("alice unlock ibToken over lock collateral", () => {
      it("should be revert", async () => {
        // 1.
        //  a. convert BUSD to ibBUSD
        //  b. open a new position
        //  c. lock ibBUSD
        //  d. mint AUSD
        const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const convertOpenLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertOpenLockTokenAndDrawCall
        )

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)

        // 2. alice repay some AUSD
        const wipeCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipe", [
          positionManager.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          positionId,
          WeiPerWad.mul(5),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        const wipeTx = await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, wipeCall)

        const [lockedCollateralAfterWipe, debtShareAfterWipe] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const alpacaStablecoinAfterWipe = await alpacaStablecoin.balanceOf(aliceAddress)

        const ibTokenBefore = await vault.balanceOf(aliceAddress)

        expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfterWipe)).to.be.equal(WeiPerWad.mul(5))
        expect(debtShareBefore.sub(debtShareAfterWipe)).to.be.equal(WeiPerWad.mul(5))

        // 3. alice unlock ibBUSD over lock collateral
        const unlockTokenCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("unlockToken", [
          positionManager.address,
          ibTokenAdapter.address,
          positionId,
          WeiPerWad.mul(15),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await expect(aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, unlockTokenCall))
          .to.be.reverted
      })
    })
    context("alice unlock ibToken over position safe", () => {
      it("should be revert", async () => {
        // 1.
        //  a. convert BUSD to ibBUSD
        //  b. open a new position
        //  c. lock ibBUSD
        //  d. mint AUSD
        const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const convertOpenLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertOpenLockTokenAndDrawCall
        )

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)

        // 2. alice repay some AUSD
        const wipeCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipe", [
          positionManager.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          positionId,
          WeiPerWad.mul(2),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        const wipeTx = await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, wipeCall)

        const [lockedCollateralAfterWipe, debtShareAfterWipe] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const alpacaStablecoinAfterWipe = await alpacaStablecoin.balanceOf(aliceAddress)

        const ibTokenBefore = await vault.balanceOf(aliceAddress)

        expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfterWipe)).to.be.equal(WeiPerWad.mul(2))
        expect(debtShareBefore.sub(debtShareAfterWipe)).to.be.equal(WeiPerWad.mul(2))

        // 3. alice unlock ibBUSD over position safe
        const unlockTokenCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("unlockToken", [
          positionManager.address,
          ibTokenAdapter.address,
          positionId,
          WeiPerWad.mul(10),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])

        await expect(
          aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, unlockTokenCall)
        ).to.be.revertedWith("BookKeeper/not-safe")
      })
    })
  })
  describe("user repay some AUSD and unlock ibToken and conver ibToken to token in single transactions", () => {
    context("alice repay AUSD over debt", () => {
      it("alice should be able to repay some AUSD and unlock ibToken and conver ibToken to token in single transactions", async () => {
        // 1. open 2 position to mint AUSD 5 + 5 = 10 AUSD
        //  a. convert BUSD to ibBUSD
        //  b. open a new position
        //  c. lock ibBUSD
        //  d. mint AUSD
        const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const convertOpenLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertOpenLockTokenAndDrawCall
        )
        const convertOpenLockTokenAndDraw2Call = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const convertOpenLockTokenAndDraw2Tx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertOpenLockTokenAndDrawCall
        )

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)

        const bookeeperStablecoinBefore = await bookKeeper.stablecoin(positionAddress)

        const baseTokenBefore = await baseToken.balanceOf(aliceAddress)

        const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        // 2.
        //  a. repay some AUSD
        //  b. alice unlock some ibBUSD
        //  c. convert BUSD to ibBUSD
        const wipeUnlockTokenAndConvertCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "wipeUnlockTokenAndConvert",
          [
            vault.address,
            positionManager.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            WeiPerWad.mul(2),
            WeiPerWad.mul(10),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const wipeUnlockTokenAndConvertTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          wipeUnlockTokenAndConvertCall
        )

        const alpacaStablecoinAfter = await alpacaStablecoin.balanceOf(aliceAddress)

        const bookeeperStablecoinAfter = await bookKeeper.stablecoin(positionAddress)

        const baseTokenAfter = await baseToken.balanceOf(aliceAddress)

        const [lockedCollateralAfter, debtShareAfter] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfter)).to.be.equal(WeiPerWad.mul(10))
        expect(bookeeperStablecoinAfter.sub(bookeeperStablecoinBefore)).to.be.equal(WeiPerRad.mul(5))
        expect(baseTokenAfter.sub(baseTokenBefore)).to.be.equal(WeiPerWad.mul(2))
        expect(debtShareBefore.sub(debtShareAfter)).to.be.equal(WeiPerWad.mul(5))
        expect(lockedCollateralBefore.sub(lockedCollateralAfter)).to.be.equal(WeiPerWad.mul(2))
      })
    })
    context("alice unlock ibToken over lock collateral", () => {
      it("should be revert", async () => {
        // 1.
        //  a. convert BUSD to ibBUSD
        //  b. open a new position
        //  c. lock ibBUSD
        //  d. mint AUSD
        const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const convertOpenLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertOpenLockTokenAndDrawCall
        )

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        // 2.
        //  a. repay some AUSD
        //  b. alice unlock some ibBUSD
        //  c. convert BUSD to ibBUSD
        const wipeUnlockTokenAndConvertCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "wipeUnlockTokenAndConvert",
          [
            vault.address,
            positionManager.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            WeiPerWad.mul(15),
            WeiPerWad.mul(5),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await expect(
          aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            wipeUnlockTokenAndConvertCall
          )
        ).to.be.reverted
      })
    })
    context("alice unlock ibToken over position safe", () => {
      it("should be revert", async () => {
        // 1.
        //  a. convert BUSD to ibBUSD
        //  b. open a new position
        //  c. lock ibBUSD
        //  d. mint AUSD
        const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const convertOpenLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertOpenLockTokenAndDrawCall
        )

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        // 2.
        //  a. repay some AUSD
        //  b. alice unlock some ibBUSD
        //  c. convert BUSD to ibBUSD
        const wipeUnlockTokenAndConvertCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "wipeUnlockTokenAndConvert",
          [
            vault.address,
            positionManager.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            WeiPerWad.mul(10),
            WeiPerWad.mul(1),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        await expect(
          aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            wipeUnlockTokenAndConvertCall
          )
        ).to.be.revertedWith("BookKeeper/not-safe")
      })
    })
    context("alice repay some AUSD and unlock ibToken and conver ibToken to token in single transactions", () => {
      it("alice should be able to repay some AUSD and unlock ibToken and conver ibToken to token in single transactions", async () => {
        // 1.
        //  a. convert BUSD to ibBUSD
        //  b. open a new position
        //  c. lock ibBUSD
        //  d. mint AUSD
        const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const convertOpenLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertOpenLockTokenAndDrawCall
        )

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)

        const baseTokenBefore = await baseToken.balanceOf(aliceAddress)

        const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        // 2.
        //  a. repay some AUSD
        //  b. alice unlock some ibBUSD
        //  c. convert BUSD to ibBUSD
        const wipeUnlockTokenAndConvertCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "wipeUnlockTokenAndConvert",
          [
            vault.address,
            positionManager.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            WeiPerWad.mul(2),
            WeiPerWad.mul(2),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const wipeUnlockTokenAndConvertTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          wipeUnlockTokenAndConvertCall
        )

        const alpacaStablecoinAfter = await alpacaStablecoin.balanceOf(aliceAddress)

        const baseTokenAfter = await baseToken.balanceOf(aliceAddress)

        const [lockedCollateralAfter, debtShareAfter] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfter)).to.be.equal(WeiPerWad.mul(2))
        expect(baseTokenAfter.sub(baseTokenBefore)).to.be.equal(WeiPerWad.mul(2))
        expect(debtShareBefore.sub(debtShareAfter)).to.be.equal(WeiPerWad.mul(2))
        expect(lockedCollateralBefore.sub(lockedCollateralAfter)).to.be.equal(WeiPerWad.mul(2))
      })
    })
  })
  describe("user repay all AUSD and unlock ibToken and conver ibToken to token in separated transactions", () => {
    context("alice repay all AUSD and unlock ibToken and conver ibToken to token in separated transactions", () => {
      it("alice should be able to repay all AUSD and unlock ibToken and conver ibToken to token in separated transactions", async () => {
        // 1.
        //  a. convert BUSD to ibBUSD
        //  b. open a new position
        //  c. lock ibBUSD
        //  d. mint AUSD
        const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const convertOpenLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertOpenLockTokenAndDrawCall
        )

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)

        // 2. alice repay all AUSD
        const wipeAllCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipeAll", [
          positionManager.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          positionId,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        const wipeTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          wipeAllCall
        )

        const [lockedCollateralAfterWipe, debtShareAfterWipe] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const alpacaStablecoinAfterWipe = await alpacaStablecoin.balanceOf(aliceAddress)

        const ibTokenBefore = await vault.balanceOf(aliceAddress)

        expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfterWipe)).to.be.equal(WeiPerWad.mul(5))
        expect(debtShareBefore.sub(debtShareAfterWipe)).to.be.equal(WeiPerWad.mul(5))

        // 3. alice unlock some ibBUSD
        const unlockTokenCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("unlockToken", [
          positionManager.address,
          ibTokenAdapter.address,
          positionId,
          WeiPerWad.mul(2),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        const unlockTokenTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          unlockTokenCall
        )

        const [lockedCollateralAfterUnlock, debtShareAfterUnlock] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const ibTokenAfter = await vault.balanceOf(aliceAddress)

        expect(lockedCollateralAfterWipe.sub(lockedCollateralAfterUnlock)).to.be.equal(WeiPerWad.mul(2))
        expect(ibTokenAfter.sub(ibTokenBefore)).to.be.equal(WeiPerWad.mul(2))

        const baseTokenBefore = await baseToken.balanceOf(aliceAddress)

        // 4. alice convert BUSD to ibBUSD
        const convertCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("ibTokenToToken", [
          vault.address,
          WeiPerWad.mul(2),
        ])
        const convertTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertCall
        )

        const baseTokenAfter = await baseToken.balanceOf(aliceAddress)

        expect(baseTokenAfter.sub(baseTokenBefore)).to.be.equal(WeiPerWad.mul(2))
      })
    })
  })
  describe("user repay all AUSD and unlock ibToken and conver ibToken to token in single transactions", () => {
    context("alice repay all AUSD and unlock ibToken and conver ibToken to token in single transactions", () => {
      it("alice should be able to repay all AUSD and unlock ibToken and conver ibToken to token in single transactions", async () => {
        // 1.
        //  a. convert BUSD to ibBUSD
        //  b. open a new position
        //  c. lock ibBUSD
        //  d. mint AUSD
        const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const convertOpenLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertOpenLockTokenAndDrawCall
        )

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)

        const baseTokenBefore = await baseToken.balanceOf(aliceAddress)

        const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        // 2.
        //  a. repay all AUSD
        //  b. alice unlock some ibBUSD
        //  c. convert BUSD to ibBUSD
        const wipeAllUnlockTokenAndConvertCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "wipeAllUnlockTokenAndConvert",
          [
            vault.address,
            positionManager.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            WeiPerWad.mul(2),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const wipeUnlockTokenAndConvertTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          wipeAllUnlockTokenAndConvertCall
        )

        const alpacaStablecoinAfter = await alpacaStablecoin.balanceOf(aliceAddress)

        const baseTokenAfter = await baseToken.balanceOf(aliceAddress)

        const [lockedCollateralAfter, debtShareAfter] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfter)).to.be.equal(WeiPerWad.mul(5))
        expect(baseTokenAfter.sub(baseTokenBefore)).to.be.equal(WeiPerWad.mul(2))
        expect(debtShareBefore.sub(debtShareAfter)).to.be.equal(WeiPerWad.mul(5))
        expect(lockedCollateralBefore.sub(lockedCollateralAfter)).to.be.equal(WeiPerWad.mul(2))
      })
    })
  })
  describe("user mint AUSD and repay AUSD (fee 20%)", () => {
    context("alice mint AUSD and repay AUSD", () => {
      it("should be able to mint and repay", async () => {
        // set stability fee rate 20% per year
        await stabilityFeeCollector.setStabilityFeeRate(
          formatBytes32String("ibBUSD"),
          BigNumber.from("1000000005781378656804591713")
        )

        // 1.
        //  a. convert BUSD to ibBUSD
        //  b. open a new position
        //  c. lock ibBUSD
        //  d. mint AUSD
        const convertOpenLockTokenAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "convertOpenLockTokenAndDraw",
          [
            vault.address,
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            formatBytes32String("ibBUSD"),
            WeiPerWad.mul(10),
            WeiPerWad.mul(5),
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const convertOpenLockTokenAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertOpenLockTokenAndDrawCall
        )

        const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
        const positionAddress = await positionManager.positions(positionId)

        const [, debtAccumulatedRateBefore] = await bookKeeper["collateralPools(bytes32)"](
          formatBytes32String("ibBUSD")
        )

        // time increase 1 year
        await TimeHelpers.increase(TimeHelpers.duration.seconds(ethers.BigNumber.from("31536000")))

        // debtAccumulatedRate ~ 20%
        await stabilityFeeCollector.collect(formatBytes32String("ibBUSD"))

        const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)

        const baseTokenBefore = await baseToken.balanceOf(aliceAddress)

        const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        const [, debtAccumulatedRateAfter] = await bookKeeper["collateralPools(bytes32)"](formatBytes32String("ibBUSD"))

        // 2.
        //  a. repay some AUSD
        //  b. alice unlock some ibBUSD
        //  c. convert BUSD to ibBUSD
        const wipeUnlockTokenAndConvertCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
          "wipeUnlockTokenAndConvert",
          [
            vault.address,
            positionManager.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            WeiPerWad.mul(1),
            WeiPerWad.mul(1),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ]
        )
        const wipeUnlockTokenAndConvertTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          wipeUnlockTokenAndConvertCall
        )

        const alpacaStablecoinAfter = await alpacaStablecoin.balanceOf(aliceAddress)

        const baseTokenAfter = await baseToken.balanceOf(aliceAddress)

        const [lockedCollateralAfter, debtShareAfter] = await bookKeeper.positions(
          formatBytes32String("ibBUSD"),
          positionAddress
        )

        expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfter)).to.be.equal(WeiPerWad.mul(1))
        expect(baseTokenAfter.sub(baseTokenBefore)).to.be.equal(WeiPerWad.mul(1))
        expect(lockedCollateralBefore.sub(lockedCollateralAfter)).to.be.equal(WeiPerWad.mul(1))
        // debtShareToRepay = 1 rad / 1.2 ray = 0.833333333333333333 wad
        AssertHelpers.assertAlmostEqual(debtShareBefore.sub(debtShareAfter).toString(), "833333333333333333")
      })
    })
  })

  describe("BNB collateral pool", () => {
    describe("user opens a new position", () => {
      context("alice opens a new position", () => {
        it("alice should be able to open a position", async () => {
          // 1. alice open a new position
          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("open", [
            positionManager.address,
            formatBytes32String("WBNB"),
            aliceProxyWallet.address,
          ])
          const tx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openPositionCall
          )
          const txReceipt = await tx.wait()
          const event = await getEvent(positionManager, txReceipt.blockNumber, "NewPosition")
          expectEmit(event, aliceProxyWallet.address, aliceProxyWallet.address, 1)
          expect(await positionManager.ownerLastPositionId(aliceProxyWallet.address)).to.be.equal(1)
        })
      })
    })
    describe("user opens a new position lock BNB and mint AUSD in separated transactions", () => {
      context("alice mint AUSD over a lock collateral value", () => {
        it("should be revert", async () => {
          // 1. alice open a new position
          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("open", [
            positionManager.address,
            formatBytes32String("WBNB"),
            aliceProxyWallet.address,
          ])
          const openTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openPositionCall
          )
          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)
          // 2. alice lock WBNB
          const lockCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("lockBNB", [
            positionManager.address,
            wbnbTokenAdapter.address,
            positionId,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const lockTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            lockCall,
            { value: WeiPerWad.mul(1) }
          )
          // 3. alice mint AUSD
          const drawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("draw", [
            positionManager.address,
            stabilityFeeCollector.address,
            wbnbTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            WeiPerWad.mul(500),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await expect(
            aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, drawCall)
          ).to.be.revertedWith("BookKeeper/not-safe")
        })
      })
      context("alice opens a new position and lock BNB and mint AUSD in separated transactions", () => {
        it("alice should be able to opens a new position and lock BNB and mint AUSD in separated transactions", async () => {
          // 1. alice open a new position
          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("open", [
            positionManager.address,
            formatBytes32String("WBNB"),
            aliceProxyWallet.address,
          ])
          const openTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openPositionCall
          )
          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)
          const [lockedCollateralBefore] = await bookKeeper.positions(formatBytes32String("WBNB"), positionAddress)
          // 3. alice lock WBNB
          const lockCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("lockBNB", [
            positionManager.address,
            wbnbTokenAdapter.address,
            positionId,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const lockTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            lockCall,
            { value: WeiPerWad.mul(1) }
          )
          const [lockedCollateralAfterlock, debtShareAfterlock] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )
          expect(lockedCollateralAfterlock.sub(lockedCollateralBefore)).to.be.equal(WeiPerWad.mul(1))
          const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)
          // 4. alice mint AUSD
          const drawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("draw", [
            positionManager.address,
            stabilityFeeCollector.address,
            wbnbTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            WeiPerWad.mul(200),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const drawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            drawCall
          )
          const [lockedCollateralAfterDraw, debtShareAfterDraw] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )
          const alpacaStablecoinAfterDraw = await alpacaStablecoin.balanceOf(aliceAddress)
          expect(debtShareAfterDraw.sub(debtShareAfterlock)).to.be.equal(WeiPerWad.mul(200))
          expect(alpacaStablecoinAfterDraw.sub(alpacaStablecoinBefore)).to.be.equal(WeiPerWad.mul(200))
        })
      })
    })
    describe("user opens a new position and lock BNB and mint AUSD in single transactions", () => {
      context("alice mint AUSD over a lock collateral value", () => {
        it("should be revert", async () => {
          // 1.
          //  a. open a new position
          //  b. lock BNB
          //  c. mint AUSD
          const openLockBNBAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              WeiPerWad.mul(500),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          await expect(
            aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openLockBNBAndDrawCall, {
              value: WeiPerWad.mul(1),
            })
          ).to.be.revertedWith("BookKeeper/not-safe")
        })
      })
      context("alice opens a new position and lock BNB and mint AUSD in single transactions", () => {
        it("alice should be able to opens a new position and lock BNB and mint AUSD in single transactions", async () => {
          // 1.
          //  a. open a new position
          //  b. lock WBNB
          //  c. mint AUSD
          const openLockBNBAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              WeiPerWad.mul(200),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const openLockBNBAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openLockBNBAndDrawCall,
            { value: WeiPerWad.mul(1) }
          )
          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)
          const [lockedCollateralAfter, debtShareAfter] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )
          const alpacaStablecoinAfter = await alpacaStablecoin.balanceOf(aliceAddress)
          expect(lockedCollateralAfter).to.be.equal(WeiPerWad.mul(1))
          expect(debtShareAfter).to.be.equal(WeiPerWad.mul(200))
          expect(alpacaStablecoinAfter).to.be.equal(WeiPerWad.mul(200))
        })
      })
    })
    describe("user repay some AUSD and unlock WBNB in separated transactions", () => {
      context("alice repay some AUSD and unlock WBNB in separated transactions", () => {
        it("alice should be able to repay some AUSD and unlock WBNB in separated transactions", async () => {
          await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"])
          // 1.
          //  a. open a new position
          //  b. lock WBNB
          //  c. mint AUSD
          const openLockBNBAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              parseEther("200"),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const openLockBNBAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openLockBNBAndDrawCall,
            { value: parseEther("1"), gasPrice: 0 }
          )
          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)
          const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )
          const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)
          // 2. alice repay some AUSD
          const wipeCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipe", [
            positionManager.address,
            wbnbTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            parseEther("100"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const wipeTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            wipeCall,
            { gasPrice: 0 }
          )
          const [lockedCollateralAfterWipe, debtShareAfterWipe] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )
          const alpacaStablecoinAfterWipe = await alpacaStablecoin.balanceOf(aliceAddress)
          const bnbBefore = await alice.getBalance()
          expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfterWipe)).to.be.equal(parseEther("100"))
          expect(debtShareBefore.sub(debtShareAfterWipe)).to.be.equal(parseEther("100"))
          // 3. alice unlock some WBNB
          const unlockTokenCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("unlockBNB", [
            positionManager.address,
            wbnbTokenAdapter.address,
            positionId,
            parseEther("0.5"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const unlockTokenTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            unlockTokenCall,
            { gasPrice: 0 }
          )
          const [lockedCollateralAfterUnlock, debtShareAfterUnlock] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )
          const bnbAfter = await alice.getBalance()
          expect(lockedCollateralAfterWipe.sub(lockedCollateralAfterUnlock)).to.be.equal(parseEther("0.5"))
          expect(bnbAfter.sub(bnbBefore)).to.be.equal(parseEther("0.5"))
        })
      })
      context("alice repay AUSD over debt", () => {
        it("alice should be able to repay some AUSD and unlock BNB in separated transactions", async () => {
          await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"])
          // 1. open 2 position to mint 200 + 200 = 400 AUSD
          //  a. open a new position
          //  b. lock WBNB
          //  c. mint AUSD
          const openLockBNBAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              parseEther("200"),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const openLockBNBAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openLockBNBAndDrawCall,
            { value: parseEther("1"), gasPrice: 0 }
          )
          const openLockBNBAndDraw2Call = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              parseEther("200"),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const openLockBNBAndDraw2Tx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openLockBNBAndDrawCall,
            { value: parseEther("1"), gasPrice: 0 }
          )
          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)
          const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )
          const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)
          const bookKeeperStablecoinBefore = await bookKeeper.stablecoin(positionAddress)
          // 2. alice repay AUSD over debt
          const wipeCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipe", [
            positionManager.address,
            wbnbTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            parseEther("400"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const wipeTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            wipeCall,
            { gasPrice: 0 }
          )
          const [lockedCollateralAfterWipe, debtShareAfterWipe] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )
          const positionAddress2 = await positionManager.positions(1)
          const [lockedCollateralAfterWipe2, debtShareAfterWipe2] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress2
          )
          const bookKeeperStablecoinAfterWipe = await bookKeeper.stablecoin(positionAddress)
          const alpacaStablecoinAfterWipe = await alpacaStablecoin.balanceOf(aliceAddress)
          expect(bookKeeperStablecoinAfterWipe.sub(bookKeeperStablecoinBefore)).to.be.equal(parseUnits("200", 45))
          expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfterWipe)).to.be.equal(parseEther("400"))
          expect(debtShareBefore.sub(debtShareAfterWipe)).to.be.equal(parseEther("200"))
          const bnbBefore = await alice.getBalance()
          // 3. alice unlock some WBNB
          const unlockBNBCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("unlockBNB", [
            positionManager.address,
            wbnbTokenAdapter.address,
            positionId,
            parseEther("0.5"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const unlockBNBTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            unlockBNBCall,
            { gasPrice: 0 }
          )
          const [lockedCollateralAfterUnlock, debtShareAfterUnlock] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )
          const bnbAfter = await alice.getBalance()
          expect(lockedCollateralAfterWipe.sub(lockedCollateralAfterUnlock)).to.be.equal(parseEther("0.5"))
          expect(bnbAfter.sub(bnbBefore)).to.be.equal(parseEther("0.5"))
        })
      })
      context("alice unlock WBNB over lock collateral", () => {
        it("should be revert", async () => {
          // 1.
          //  a. open a new position
          //  b. lock WBNB
          //  c. mint AUSD
          const openLockBNBAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              parseEther("200"),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const openLockBNBAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openLockBNBAndDrawCall,
            { value: parseEther("1"), gasPrice: 0 }
          )
          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)
          // 2. alice repay some AUSD
          const wipeCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipe", [
            positionManager.address,
            wbnbTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            parseEther("100"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const wipeTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            wipeCall
          )
          // 3. alice unlock WBNB over lock collateral
          const unlockTokenCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("unlockBNB", [
            positionManager.address,
            wbnbTokenAdapter.address,
            positionId,
            parseEther("1.5"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await expect(
            aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, unlockTokenCall)
          ).to.be.reverted
        })
      })
      context("alice unlock WBNB over position safe", () => {
        it("should be revert", async () => {
          // 1.
          //  a. open a new position
          //  b. lock WBNB
          //  c. mint AUSD
          const openLockBNBAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              parseEther("200"),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const openLockBNBAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openLockBNBAndDrawCall,
            { value: parseEther("1"), gasPrice: 0 }
          )
          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)
          // 2. alice repay some AUSD
          const wipeCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipe", [
            positionManager.address,
            wbnbTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            parseEther("100"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const wipeTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            wipeCall,
            { gasPrice: 0 }
          )
          // 3. alice unlock WBNB over position safe
          const unlockTokenCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("unlockBNB", [
            positionManager.address,
            wbnbTokenAdapter.address,
            positionId,
            parseEther("1"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await expect(
            aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, unlockTokenCall)
          ).to.be.revertedWith("BookKeeper/not-safe")
        })
      })
    })
    describe("user repay some AUSD and unlock BNB in single transactions", () => {
      context("alice repay AUSD over debt", () => {
        it("alice should be able to repay some AUSD and unlock BNB in single transactions", async () => {
          await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"])
          // 1. open 2 position to mint 200 + 200 = 400 AUSD
          //  a. open a new position
          //  b. lock WBNB
          //  c. mint AUSD
          const openLockBNBAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              parseEther("200"),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const openLockBNBAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openLockBNBAndDrawCall,
            { value: parseEther("1"), gasPrice: 0 }
          )
          const openLockBNBAndDraw2Call = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              parseEther("200"),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const openLockBNBAndDraw2Tx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openLockBNBAndDrawCall,
            { value: parseEther("1"), gasPrice: 0 }
          )

          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)

          const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)
          const bookeeperStablecoinBefore = await bookKeeper.stablecoin(positionAddress)
          const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )

          // 2.
          //  a. repay some AUSD
          //  b. alice unlock some BNB
          const wipeAndUnlockBNBCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipeAndUnlockBNB", [
            positionManager.address,
            wbnbTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            parseEther("0.5"),
            parseEther("400"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const wipeAndUnlockBNBTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            wipeAndUnlockBNBCall
          )

          const alpacaStablecoinAfter = await alpacaStablecoin.balanceOf(aliceAddress)
          const bookeeperStablecoinAfter = await bookKeeper.stablecoin(positionAddress)
          const [lockedCollateralAfter, debtShareAfter] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )
          expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfter)).to.be.equal(parseEther("400"))
          expect(bookeeperStablecoinAfter.sub(bookeeperStablecoinBefore)).to.be.equal(parseUnits("200", 45))
          expect(debtShareBefore.sub(debtShareAfter)).to.be.equal(parseEther("200"))
          expect(lockedCollateralBefore.sub(lockedCollateralAfter)).to.be.equal(parseEther("0.5"))
        })
      })
      context("alice unlock BNB over lock collateral", () => {
        it("should be revert", async () => {
          await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"])
          // 1.
          //  a. open a new position
          //  b. lock WBNB
          //  c. mint AUSD
          const openLockBNBAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              parseEther("200"),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const openLockBNBAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openLockBNBAndDrawCall,
            { value: parseEther("1"), gasPrice: 0 }
          )

          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)

          // 2.
          //  a. repay some AUSD
          //  b. alice unlock some WBNB
          const wipeAndUnlockBNBCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipeAndUnlockBNB", [
            positionManager.address,
            wbnbTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            parseEther("1.5"),
            parseEther("100"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await expect(
            aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, wipeAndUnlockBNBCall)
          ).to.be.reverted
        })
      })
      context("alice unlock BNB over position safe", () => {
        it("should be revert", async () => {
          await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"])
          // 1.
          //  a. open a new position
          //  b. lock WBNB
          //  c. mint AUSD
          const openLockBNBAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              parseEther("200"),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const openLockBNBAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openLockBNBAndDrawCall,
            { value: parseEther("1"), gasPrice: 0 }
          )

          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)

          // 2.
          //  a. repay some AUSD
          //  b. alice unlock some WBNB
          const wipeAndUnlockBNBCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipeAndUnlockBNB", [
            positionManager.address,
            wbnbTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            parseEther("1"),
            parseEther("100"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await expect(
            aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, wipeAndUnlockBNBCall)
          ).to.be.revertedWith("BookKeeper/not-safe")
        })
      })
      context("alice repay some AUSD and unlock BNB in single transactions", () => {
        it("alice should be able to repay some AUSD and unlock BNB in single transactions", async () => {
          await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"])
          // 1.
          //  a. open a new position
          //  b. lock WBNB
          //  c. mint AUSD
          const openLockBNBAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              parseEther("200"),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const openLockBNBAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openLockBNBAndDrawCall,
            { value: parseEther("1"), gasPrice: 0 }
          )

          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)
          const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)
          const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )

          // 2.
          //  a. repay some AUSD
          //  b. alice unlock some WBNB
          const wipeAndUnlockBNBCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipeAndUnlockBNB", [
            positionManager.address,
            wbnbTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            parseEther("0.5"),
            parseEther("100"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const wipeUnlockTokenAndConvertTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            wipeAndUnlockBNBCall
          )

          const alpacaStablecoinAfter = await alpacaStablecoin.balanceOf(aliceAddress)
          const [lockedCollateralAfter, debtShareAfter] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )
          expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfter)).to.be.equal(parseEther("100"))
          expect(debtShareBefore.sub(debtShareAfter)).to.be.equal(parseEther("100"))
          expect(lockedCollateralBefore.sub(lockedCollateralAfter)).to.be.equal(parseEther("0.5"))
        })
      })
    })
    describe("user repay all AUSD and unlock BNB in separated transactions", () => {
      context("alice repay all AUSD and unlock BNB in separated transactions", () => {
        it("alice should be able to repay all AUSD and unlock BNB in separated transactions", async () => {
          await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"])
          // 1.
          //  a. open a new position
          //  b. lock WBNB
          //  c. mint AUSD
          const openLockBNBAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              parseEther("200"),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const openLockBNBAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openLockBNBAndDrawCall,
            { value: parseEther("1"), gasPrice: 0 }
          )

          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)

          const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )
          const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)

          // 2. alice repay all AUSD
          const wipeAllCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("wipeAll", [
            positionManager.address,
            wbnbTokenAdapter.address,
            stablecoinAdapter.address,
            positionId,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const wipeTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            wipeAllCall
          )

          const [lockedCollateralAfterWipe, debtShareAfterWipe] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )
          const alpacaStablecoinAfterWipe = await alpacaStablecoin.balanceOf(aliceAddress)

          expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfterWipe)).to.be.equal(parseEther("200"))
          expect(debtShareBefore.sub(debtShareAfterWipe)).to.be.equal(parseEther("200"))

          // 3. alice unlock some WBNB
          const unlockBNBCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("unlockBNB", [
            positionManager.address,
            wbnbTokenAdapter.address,
            positionId,
            parseEther("0.5"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          const unlockBNBTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            unlockBNBCall
          )

          const [lockedCollateralAfterUnlock, debtShareAfterUnlock] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )

          expect(lockedCollateralAfterWipe.sub(lockedCollateralAfterUnlock)).to.be.equal(parseEther("0.5"))
        })
      })
    })
    describe("user repay all AUSD and unlock BNB in single transactions", () => {
      context("alice repay all AUSD and unlock BNB in single transactions", () => {
        it("alice should be able to repay all AUSD and unlock BNB in single transactions", async () => {
          // 1.
          //  a. open a new position
          //  b. lock WBNB
          //  c. mint AUSD
          const openLockBNBAndDrawCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "openLockBNBAndDraw",
            [
              positionManager.address,
              stabilityFeeCollector.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              formatBytes32String("WBNB"),
              parseEther("200"),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const openLockBNBAndDrawTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            openLockBNBAndDrawCall,
            { value: parseEther("1"), gasPrice: 0 }
          )

          const positionId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)
          const positionAddress = await positionManager.positions(positionId)

          const alpacaStablecoinBefore = await alpacaStablecoin.balanceOf(aliceAddress)

          const [lockedCollateralBefore, debtShareBefore] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )

          // 2.
          //  a. repay all AUSD
          //  b. alice unlock some WBNB
          const wipeAllAndUnlockBNBCall = alpacaStablecoinProxyActions.interface.encodeFunctionData(
            "wipeAllAndUnlockBNB",
            [
              positionManager.address,
              wbnbTokenAdapter.address,
              stablecoinAdapter.address,
              positionId,
              parseEther("0.5"),
              ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
            ]
          )
          const wipeUnlockTokenAndConvertTx = await aliceProxyWallet["execute(address,bytes)"](
            alpacaStablecoinProxyActions.address,
            wipeAllAndUnlockBNBCall
          )

          const alpacaStablecoinAfter = await alpacaStablecoin.balanceOf(aliceAddress)

          const [lockedCollateralAfter, debtShareAfter] = await bookKeeper.positions(
            formatBytes32String("WBNB"),
            positionAddress
          )

          expect(alpacaStablecoinBefore.sub(alpacaStablecoinAfter)).to.be.equal(parseEther("200"))
          expect(debtShareBefore.sub(debtShareAfter)).to.be.equal(parseEther("200"))
          expect(lockedCollateralBefore.sub(lockedCollateralAfter)).to.be.equal(parseEther("0.5"))
        })
      })
    })
  })
})
