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
  AlpacaToken,
  FairLaunch,
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
  showStopper: ShowStopper
  bookKeeper: BookKeeper
  liquidationEngine: LiquidationEngine
  systemDebtEngine: SystemDebtEngine
  priceOracle: PriceOracle
}

const loadFixtureHandler = async (): Promise<Fixture> => {
  const [deployer, alice, , dev] = await ethers.getSigners()

  //   // alpca vault
  //   const ALPACA_BONUS_LOCK_UP_BPS = 7000
  //   const ALPACA_REWARD_PER_BLOCK = ethers.utils.parseEther("5000")
  //   const RESERVE_POOL_BPS = "1000" // 10% reserve pool
  //   const KILL_PRIZE_BPS = "1000" // 10% Kill prize
  //   const INTEREST_RATE = "3472222222222" // 30% per year
  //   const MIN_DEBT_SIZE = ethers.utils.parseEther("1") // 1 BTOKEN min debt size
  //   const KILL_TREASURY_BPS = "100"

  //   const WBNB = new MockWBNB__factory(deployer)
  //   const wbnb = (await WBNB.deploy()) as MockWBNB
  //   await wbnb.deployed()

  //   const WNativeRelayer = new WNativeRelayer__factory(deployer)
  //   const wNativeRelayer = (await WNativeRelayer.deploy(wbnb.address)) as WNativeRelayer
  //   await wNativeRelayer.deployed()

  //   // Deploy mocked BEP20
  //   const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  //   const ibDUMMY = await BEP20.deploy("ibDUMMY", "ibDUMMY")
  //   await ibDUMMY.deployed()

  //   const baseToken = await BEP20.deploy("BTOKEN", "BTOKEN")
  //   await baseToken.deployed()
  //   await baseToken.mint(await deployer.getAddress(), ethers.utils.parseEther("100"))
  //   await baseToken.mint(await alice.getAddress(), ethers.utils.parseEther("100"))

  //   const DebtToken = new DebtToken__factory(deployer)
  //   const debtToken = await DebtToken.deploy()
  //   await debtToken.deployed()
  //   await debtToken.initialize("debtibBTOKEN_V2", "debtibBTOKEN_V2", deployer.address)

  //   // Setup FairLaunch contract
  //   // Deploy ALPACAs
  //   const AlpacaToken = new AlpacaToken__factory(deployer)
  //   const alpacaToken = await AlpacaToken.deploy(132, 137)
  //   await alpacaToken.deployed()

  //   const FairLaunch = new FairLaunch__factory(deployer)
  //   const fairLaunch = (await FairLaunch.deploy(
  //     alpacaToken.address,
  //     deployer.address,
  //     ALPACA_REWARD_PER_BLOCK,
  //     0,
  //     ALPACA_BONUS_LOCK_UP_BPS,
  //     0
  //   )) as FairLaunch
  //   await fairLaunch.deployed()

  //   const Shield = (await ethers.getContractFactory("Shield", deployer)) as Shield__factory
  //   const shield = await Shield.deploy(deployer.address, fairLaunch.address)
  //   await shield.deployed()

  //   const SimpleVaultConfig = new SimpleVaultConfig__factory(deployer)
  //   const simpleVaultConfig = await SimpleVaultConfig.deploy()
  //   await simpleVaultConfig.deployed()
  //   await simpleVaultConfig.initialize(
  //     MIN_DEBT_SIZE,
  //     INTEREST_RATE,
  //     RESERVE_POOL_BPS,
  //     KILL_PRIZE_BPS,
  //     wbnb.address,
  //     wNativeRelayer.address,
  //     fairLaunch.address,
  //     KILL_TREASURY_BPS,
  //     deployer.address
  //   )

  //   const Vault = new Vault__factory(deployer)
  //   const busdVault = await Vault.deploy()
  //   await busdVault.deployed()
  //   await busdVault.initialize(
  //     simpleVaultConfig.address,
  //     baseToken.address,
  //     "Interest Bearing BTOKEN",
  //     "ibBTOKEN",
  //     18,
  //     debtToken.address
  //   )

  //   // Config Alpaca's FairLaunch
  //   // Assuming Deployer is timelock for easy testing
  //   await fairLaunch.addPool(1, busdVault.address, true)
  //   await fairLaunch.transferOwnership(shield.address)
  //   await shield.transferOwnership(await deployer.getAddress())
  //   await alpacaToken.transferOwnership(fairLaunch.address)

  //   // Deploy AlpacaStablecoin
  //   const AlpacaStablecoin = new AlpacaStablecoin__factory(deployer)
  //   const alpacaStablecoin = await AlpacaStablecoin.deploy("Alpaca USD", "AUSD", "31337")

  const BookKeeper = new BookKeeper__factory(deployer)
  const bookKeeper = (await upgrades.deployProxy(BookKeeper)) as BookKeeper

  //   await bookKeeper.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployer.address)

  //   await bookKeeper.init(formatBytes32String("ibBUSD"))
  //   // set pool debt ceiling 100 rad
  //   await bookKeeper.setDebtCeiling(formatBytes32String("ibBUSD"), WeiPerRad.mul(100))
  //   // set price with safety margin 1 ray
  //   await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("ibBUSD"), WeiPerRay)
  //   // set position debt floor 1 rad
  //   await bookKeeper.setDebtFloor(formatBytes32String("ibBUSD"), WeiPerRad.mul(1))
  //   // set total debt ceiling 100 rad
  //   await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(100))

  //   const PositionManager = new PositionManager__factory(deployer)
  //   const positionManager = (await upgrades.deployProxy(PositionManager, [bookKeeper.address])) as PositionManager

  //   const AlpacaStablecoinProxyActions = new AlpacaStablecoinProxyActions__factory(deployer)
  //   const alpacaStablecoinProxyActions = await AlpacaStablecoinProxyActions.deploy()

  //   const IbTokenAdapter = (await ethers.getContractFactory("IbTokenAdapter", deployer)) as IbTokenAdapter__factory
  //   const ibTokenAdapter = (await upgrades.deployProxy(IbTokenAdapter, [
  //     bookKeeper.address,
  //     formatBytes32String("ibBUSD"),
  //     busdVault.address,
  //     alpacaToken.address,
  //     fairLaunch.address,
  //     0,
  //     shield.address,
  //     await deployer.getAddress(),
  //     BigNumber.from(1000),
  //     await dev.getAddress(),
  //   ])) as IbTokenAdapter

  //   const StablecoinAdapter = new StablecoinAdapter__factory(deployer)
  //   const stablecoinAdapter = (await upgrades.deployProxy(StablecoinAdapter, [
  //     bookKeeper.address,
  //     alpacaStablecoin.address,
  //   ])) as StablecoinAdapter

  //   // Deploy StabilityFeeCollector
  //   const StabilityFeeCollector = new StabilityFeeCollector__factory(deployer)
  //   const stabilityFeeCollector = (await upgrades.deployProxy(StabilityFeeCollector, [
  //     bookKeeper.address,
  //   ])) as StabilityFeeCollector

  //   await stabilityFeeCollector.init(formatBytes32String("ibBUSD"))

  //   await bookKeeper.grantRole(ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]), ibTokenAdapter.address)
  //   await bookKeeper.grantRole(
  //     ethers.utils.solidityKeccak256(["string"], ["POSITION_MANAGER_ROLE"]),
  //     positionManager.address
  //   )
  //   await bookKeeper.grantRole(
  //     ethers.utils.solidityKeccak256(["string"], ["STABILITY_FEE_COLLECTOR_ROLE"]),
  //     stabilityFeeCollector.address
  //   )

  //   await alpacaStablecoin.grantRole(await alpacaStablecoin.MINTER_ROLE(), stablecoinAdapter.address)

  const SystemDebtEngine = new SystemDebtEngine__factory(deployer)
  const systemDebtEngine = (await upgrades.deployProxy(SystemDebtEngine, [bookKeeper.address])) as SystemDebtEngine

  const LiquidationEngine = new LiquidationEngine__factory(deployer)
  const liquidationEngine = (await upgrades.deployProxy(LiquidationEngine, [
    bookKeeper.address,
    systemDebtEngine.address,
  ])) as LiquidationEngine

  const PriceOracle = new PriceOracle__factory(deployer)
  const priceOracle = (await upgrades.deployProxy(PriceOracle, [bookKeeper.address])) as PriceOracle

  const PriceFeed = new MockPriceFeed__factory(deployer)
  const priceFeed = await up

  const ShowStopper = new ShowStopper__factory(deployer)
  const showStopper = (await upgrades.deployProxy(ShowStopper)) as ShowStopper

  await showStopper.setBookKeeper(bookKeeper.address)
  await showStopper.setLiquidationEngine(liquidationEngine.address)
  await showStopper.setSystemDebtEngine(systemDebtEngine.address)
  await showStopper.setPriceOracle(priceOracle.address)

  return {
    showStopper,
    bookKeeper,
    liquidationEngine,
    systemDebtEngine,
    priceOracle,
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

  let showStopper: ShowStopper
  let bookKeeper: BookKeeper
  let liquidationEngine: LiquidationEngine
  let systemDebtEngine: SystemDebtEngine
  let priceOracle: PriceOracle
  let priceFeed: MockPriceFeed

  beforeEach(async () => {
    ;({ showStopper, bookKeeper, liquidationEngine, systemDebtEngine, priceOracle } = await loadFixtureHandler())
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])
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

    context("", () => {
      it("", async () => {
        await bookKeeper.grantRole(await bookKeeper.SHOW_STOPPER_ROLE(), showStopper.address)
        await liquidationEngine.grantRole(await liquidationEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await systemDebtEngine.grantRole(await systemDebtEngine.SHOW_STOPPER_ROLE(), showStopper.address)
        await priceOracle.grantRole(await priceOracle.SHOW_STOPPER_ROLE(), showStopper.address)

        await showStopper["cage()"]()

        await showStopper["cage(bytes32)"](formatBytes32String("busd"))
      })
    })
  })
})
