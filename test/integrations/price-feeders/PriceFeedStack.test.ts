/*
For any ibBASE pool (except BUSD)

┌─────────────────┐         ┌──────────────────────────┐
│SimplePriceOracle├────────►│AlpacaPriceOraclePriceFeed├──────────┐
└──ib/base────────┘         └───ib/base────────────────┘          ▼
                                                                ┌────────────────┐
┌────────────────────┐                                          │IbTokenPriceFeed│
│ChainLinkPriceOracle├───────┐                                  └────ib/USD──────┘
└──base/BUSD─────────┘       ▼                                    ▲
                            ┌────────────────────────────────┐    │
                            │StrictAlpacaPriceOraclePriceFeed├────┘
                            └───base/USD─────────────────────┘
┌───────────────┐             ▲
│BandPriceOracle├─────────────┘
└──base/USD──-──┘

StrictAlpacaPriceOraclePriceFeed config
- primarySource token0 = base token address
- primarySource token1 = BUSD address (BUSD is assumed to be USD on ChainLinkPriceOracle)
- secondarySource token0 = base token address
- secondarySource token1 = USD address (0xfff...fff)
*/

/*
For any ibBUSD pool
(** USD will be treated as 0xfff...fff)
┌─────────────────┐         ┌──────────────────────────┐
│SimplePriceOracle├────────►│AlpacaPriceOraclePriceFeed├──────────┐
└──ibBUSD/BUSD────┘         └──ibBUSD/BUSD─────────────┘          ▼
                                                                ┌────────────────┐
┌────────────────────┐                                          │IbTokenPriceFeed│
│ChainLinkPriceOracle├───────┐                                  └──ibBUSD/USD───┘
└──BUSD/USD-─────────┘       ▼                                    ▲
                            ┌────────────────────────────────┐    │
                            │StrictAlpacaPriceOraclePriceFeed├────┘
                            └───BUSD/USD-────────────────────┘
┌───────────────┐             ▲
│BandPriceOracle├─────────────┘
└──BUSD/USD─────┘


StrictAlpacaPriceOraclePriceFeed config
- primarySource token0 = BUSD address
- primarySource token1 = USD address (0xfff...fff)
- secondarySource token0 = BUSD address
- secondarySource token1 = USD address (0xfff...fff)
*/

import {
  DebtToken__factory,
  MockWBNB,
  MockWBNB__factory,
  PancakeFactory__factory,
  PancakePair__factory,
  SimplePriceOracle,
  SimplePriceOracle__factory,
  SimpleVaultConfig__factory,
  Vault,
  Vault__factory,
  WNativeRelayer,
  WNativeRelayer__factory,
} from "@alpaca-finance/alpaca-contract/typechain"
import { MockContract, smockit } from "@eth-optimism/smock"
import { BigNumber } from "@ethersproject/bignumber"
import { expect } from "chai"
import { MockProvider } from "ethereum-waffle"
import { Signer, Wallet } from "ethers"
import { parseEther } from "ethers/lib/utils"
import { ethers, upgrades, waffle } from "hardhat"
import { DateTime } from "luxon"
import * as TimeHelpers from "../../helper/time"
import {
  AccessControlConfig,
  AccessControlConfig__factory,
  MockAlpacaOracle,
  MockAlpacaOracle__factory,
  StrictAlpacaOraclePriceFeed,
  StrictAlpacaOraclePriceFeed__factory,
  AlpacaOraclePriceFeed,
  AlpacaOraclePriceFeed__factory,
  IbTokenPriceFeed,
  IbTokenPriceFeed__factory,
  DexPriceOracle,
  DexPriceOracle__factory,
  BandPriceOracle,
  BandPriceOracle__factory,
  MockStdReference__factory,
  AlpacaToken__factory,
  FairLaunch__factory,
  VaultPriceOracle__factory,
  VaultPriceOracle,
  SimplePriceFeed,
  SimplePriceFeed__factory,
} from "../../../typechain"
import { AddressFour, AddressOne, AddressThree, AddressTwo, AddressZero } from "../../helper/address"

type fixture = {
  strictWbnbInBusdPriceFeed1: StrictAlpacaOraclePriceFeed // Dex strict version
  strictWbnbInBusdPriceFeed2: StrictAlpacaOraclePriceFeed // Band strict version
  strictibBNBInBasePriceFeed1: StrictAlpacaOraclePriceFeed // Vault strict version
  ibTokenPriceFeed1: IbTokenPriceFeed // Dex strict version
  ibTokenPriceFeed2: IbTokenPriceFeed // Band strict version
  ibTokenPriceFeed3: IbTokenPriceFeed // Vault strict version
  ibInWbnbPriceFeed: AlpacaOraclePriceFeed
  dexPriceOracle: DexPriceOracle // [Deperecated] use as base/busd price source actual (secondary source)
  bandPriceOracle: BandPriceOracle // use as base/busd price source actual (secondary source)
  vaultPriceOracle: VaultPriceOracle // use as ib/base price source actual (secondary source)
  accessControlConfig: AccessControlConfig
  mockedSimpleOracle: MockContract // use as ib/base price source
  simplePriceOracle: SimplePriceOracle
  mockedChainLinkOracle: MockContract // use as base/busd price source actual (primary source)
  mockedPcsFactory: MockContract
  mockedPancakePair: MockContract
  mockedStdReference: MockContract
  bnbVault: Vault
  wbnb: MockWBNB
}

const ibWBNBAddress = AddressOne
const wbnbAddress = AddressTwo
const busdAddress = AddressThree
const usdAddress = AddressFour
const ORACLE_TIME_DELAY = 900

const nHoursAgoInSec = (now: DateTime, n: number): BigNumber => {
  const d = now.minus({ hours: n })
  return BigNumber.from(Math.floor(d.toSeconds()))
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked AlpacaOracle
  const MockAlpacaOracle = (await ethers.getContractFactory("MockAlpacaOracle", deployer)) as MockAlpacaOracle__factory
  const mockSimpleOracle = (await upgrades.deployProxy(MockAlpacaOracle, [])) as MockAlpacaOracle
  await mockSimpleOracle.deployed()
  const mockedSimpleOracle = await smockit(mockSimpleOracle)

  const mockChainLinkOracle = (await upgrades.deployProxy(MockAlpacaOracle, [])) as MockAlpacaOracle
  await mockChainLinkOracle.deployed()
  const mockedChainLinkOracle = await smockit(mockChainLinkOracle)

  // Deploy mocked PancakePair
  const pancakePair = await new PancakePair__factory(deployer).deploy()
  await pancakePair.deployed()
  const mockedPancakePair = await smockit(pancakePair)
  // Deploy mocked PancakeFactory
  const pcsFactory = await new PancakeFactory__factory(deployer).deploy(AddressZero)
  await pcsFactory.deployed()
  const mockedPcsFactory = await smockit(pcsFactory)

  // Deploy mocked StdReference
  const mockStdReference = await new MockStdReference__factory(deployer).deploy()
  await mockStdReference.deployed()
  const mockedStdReference = await smockit(mockStdReference)

  // Deploy AccessControlConfig
  const AccessControlConfig = (await ethers.getContractFactory(
    "AccessControlConfig",
    deployer
  )) as AccessControlConfig__factory
  const accessControlConfig = (await upgrades.deployProxy(AccessControlConfig, [])) as AccessControlConfig
  await accessControlConfig.deployed()

  // Deploy DexPriceOracle
  const DexPriceOracle = (await ethers.getContractFactory("DexPriceOracle", deployer)) as DexPriceOracle__factory
  mockedPcsFactory.smocked.getPair.will.return.with(mockedPancakePair.address)
  const dexPriceOracle = (await upgrades.deployProxy(DexPriceOracle, [mockedPcsFactory.address])) as DexPriceOracle
  await dexPriceOracle.deployed()

  // Deploy BandPriceOracle
  const BandPriceOracle = (await ethers.getContractFactory("BandPriceOracle", deployer)) as BandPriceOracle__factory
  const bandPriceOracle = (await upgrades.deployProxy(BandPriceOracle, [
    mockedStdReference.address,
    accessControlConfig.address,
  ])) as BandPriceOracle
  await bandPriceOracle.deployed()

  // setup token symbol for sanity check
  await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployer.address)
  await bandPriceOracle.setTokenSymbol(wbnbAddress, "BNB")
  await bandPriceOracle.setTokenSymbol(busdAddress, "BUSD")

  const VaultPriceOracle = (await ethers.getContractFactory("VaultPriceOracle", deployer)) as VaultPriceOracle__factory
  const vaultPriceOracle = (await upgrades.deployProxy(VaultPriceOracle)) as VaultPriceOracle
  await vaultPriceOracle.deployed()

  // Deploy AlpacaOraclePriceFeed
  const AlpacaOraclePriceFeed = (await ethers.getContractFactory(
    "AlpacaOraclePriceFeed",
    deployer
  )) as AlpacaOraclePriceFeed__factory
  const ibInWbnbPriceFeed = (await upgrades.deployProxy(AlpacaOraclePriceFeed, [
    mockedSimpleOracle.address,
    ibWBNBAddress,
    wbnbAddress,
    accessControlConfig.address,
  ])) as AlpacaOraclePriceFeed
  await ibInWbnbPriceFeed.deployed()

  // mocked for StrictAlpacaOraclePriceFeed sanity check
  mockedChainLinkOracle.smocked.getPrice.will.return.with([1, 1])
  mockedPancakePair.smocked.getReserves.will.return.with([1, 1, 0])

  // Deploy StrictAlpacaOraclePriceFeed
  const StrictAlpacaOraclePriceFeed = (await ethers.getContractFactory(
    "StrictAlpacaOraclePriceFeed",
    deployer
  )) as StrictAlpacaOraclePriceFeed__factory

  // use DexPriceOracle as secondary source
  const strictWbnbInBusdPriceFeed1 = (await upgrades.deployProxy(StrictAlpacaOraclePriceFeed, [
    mockedChainLinkOracle.address,
    wbnbAddress,
    busdAddress,
    dexPriceOracle.address,
    wbnbAddress,
    busdAddress,
    accessControlConfig.address,
  ])) as StrictAlpacaOraclePriceFeed
  await strictWbnbInBusdPriceFeed1.deployed()

  // use BandPriceOracle as secondary source
  const strictWbnbInBusdPriceFeed2 = (await upgrades.deployProxy(StrictAlpacaOraclePriceFeed, [
    mockedChainLinkOracle.address,
    wbnbAddress,
    busdAddress,
    bandPriceOracle.address,
    wbnbAddress,
    busdAddress,
    accessControlConfig.address,
  ])) as StrictAlpacaOraclePriceFeed
  await strictWbnbInBusdPriceFeed2.deployed()

  // reset ocked for StrictAlpacaOraclePriceFeed sanity check
  mockedChainLinkOracle.smocked.getPrice.reset()
  mockedPancakePair.smocked.getReserves.reset()

  const IbTokenPriceFeed = (await ethers.getContractFactory("IbTokenPriceFeed", deployer)) as IbTokenPriceFeed__factory

  const now = DateTime.now()
  // mock reserve 1 WBNB = 400 BUSD
  mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
  // mock chainlink oracle to return 1 WBNB = 401 BUSD
  mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
  // mock simple oracle to return 1 ibWBNB = 1.1 BNB
  mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])
  // Deploy IbTokenPriceFeed (Dex strict version)
  const ibTokenPriceFeed1 = (await upgrades.deployProxy(IbTokenPriceFeed, [
    ibInWbnbPriceFeed.address,
    strictWbnbInBusdPriceFeed1.address,
    accessControlConfig.address,
    ORACLE_TIME_DELAY,
  ])) as IbTokenPriceFeed
  await ibTokenPriceFeed1.deployed()

  // mock chainlink oracle to return 1 WBNB = 401 BUSD
  mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
  // mock chainlink oracle to return 1 WBNB = 401 BUSD
  mockedStdReference.smocked.getReferenceData.will.return.with({
    rate: parseEther("401"),
    lastUpdatedBase: nHoursAgoInSec(now, 1),
    lastUpdatedQuote: nHoursAgoInSec(now, 1),
  })
  // mock simple oracle to return 1 ibWBNB = 1.1 BNB
  mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])
  // Deploy IbTokenPriceFeed (Band strict version)
  const ibTokenPriceFeed2 = (await upgrades.deployProxy(IbTokenPriceFeed, [
    ibInWbnbPriceFeed.address,
    strictWbnbInBusdPriceFeed2.address,
    accessControlConfig.address,
    ORACLE_TIME_DELAY,
  ])) as IbTokenPriceFeed
  await ibTokenPriceFeed2.deployed()

  /// Deploy SimpleOracle
  const SimplePriceOracle = new SimplePriceOracle__factory(deployer)
  // const SimplePriceOracle = (await ethers.getContractFactory(
  //   "SimplePriceOracle",
  //   deployer
  // )) as SimplePriceOracle__factory
  const simplePriceOracle = await SimplePriceOracle.deploy()
  await simplePriceOracle.deployed()
  await simplePriceOracle.initialize(deployer.address)
  // const simplePriceOracle = (await upgrades.deployProxy(SimplePriceOracle, [deployer])) as SimplePriceOracle
  // await simplePriceOracle.deployed()

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

  await wbnb.mint(deployer.address, parseEther("1"))

  const WNativeRelayer = new WNativeRelayer__factory(deployer)
  const wNativeRelayer = (await WNativeRelayer.deploy(wbnb.address)) as WNativeRelayer
  await wNativeRelayer.deployed()

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

  const bnbVault = await Vault.deploy()
  await bnbVault.deployed()
  await bnbVault.initialize(
    simpleVaultConfig.address,
    wbnb.address,
    "Interest Bearing BNB",
    "ibBNB",
    18,
    debtToken.address
  )

  await simplePriceOracle.setPrices([bnbVault.address], [wbnb.address], [parseEther("1")])

  // use VaultPriceOracle as secondary source
  const strictibBNBInBasePriceFeed1 = (await upgrades.deployProxy(StrictAlpacaOraclePriceFeed, [
    simplePriceOracle.address,
    bnbVault.address,
    wbnb.address,
    vaultPriceOracle.address,
    bnbVault.address,
    wbnb.address,
    accessControlConfig.address,
  ])) as StrictAlpacaOraclePriceFeed
  await strictibBNBInBasePriceFeed1.deployed()

  await bnbVault.deposit(parseEther("1"), { value: parseEther("1") })
  await simplePriceOracle.setPrices([bnbVault.address], [wbnb.address], [parseEther("1")])
  await vaultPriceOracle.setVault(bnbVault.address, true)
  await strictibBNBInBasePriceFeed1.setPriceLife(23 * 60 * 60)

  // Deploy IbTokenPriceFeed (Vault strict version)
  const ibTokenPriceFeed3 = (await upgrades.deployProxy(IbTokenPriceFeed, [
    strictibBNBInBasePriceFeed1.address,
    strictWbnbInBusdPriceFeed2.address,
    accessControlConfig.address,
    ORACLE_TIME_DELAY,
  ])) as IbTokenPriceFeed
  await ibTokenPriceFeed3.deployed()

  return {
    strictWbnbInBusdPriceFeed1,
    strictWbnbInBusdPriceFeed2,
    strictibBNBInBasePriceFeed1,
    ibInWbnbPriceFeed,
    ibTokenPriceFeed1,
    ibTokenPriceFeed2,
    ibTokenPriceFeed3,
    dexPriceOracle,
    bandPriceOracle,
    vaultPriceOracle,
    mockedSimpleOracle,
    simplePriceOracle,
    mockedChainLinkOracle,
    accessControlConfig,
    mockedPcsFactory,
    mockedPancakePair,
    mockedStdReference,
    bnbVault,
    wbnb,
  }
}

describe("PriceFeedStack", () => {
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

  let strictWbnbInBusdPriceFeed1: StrictAlpacaOraclePriceFeed
  let strictWbnbInBusdPriceFeed2: StrictAlpacaOraclePriceFeed
  let strictibBNBInBasePriceFeed1: StrictAlpacaOraclePriceFeed
  let ibInWbnbPriceFeed: AlpacaOraclePriceFeed
  let ibTokenPriceFeed1: IbTokenPriceFeed
  let ibTokenPriceFeed2: IbTokenPriceFeed
  let ibTokenPriceFeed3: IbTokenPriceFeed
  let dexPriceOracle: DexPriceOracle
  let bandPriceOracle: BandPriceOracle
  let vaultPriceOracle: VaultPriceOracle
  let accessControlConfig: AccessControlConfig
  let mockedSimpleOracle: MockContract
  let mockedChainLinkOracle: MockContract
  let mockedPcsFactory: MockContract
  let mockedPancakePair: MockContract
  let mockedStdReference: MockContract
  let bnbVault: Vault
  let simplePriceOracle: SimplePriceOracle

  let wbnb: MockWBNB

  beforeEach(async () => {
    ;({
      strictWbnbInBusdPriceFeed1,
      strictWbnbInBusdPriceFeed2,
      strictibBNBInBasePriceFeed1,
      ibInWbnbPriceFeed,
      ibTokenPriceFeed1,
      ibTokenPriceFeed2,
      ibTokenPriceFeed3,
      dexPriceOracle,
      mockedSimpleOracle,
      simplePriceOracle,
      mockedChainLinkOracle,
      vaultPriceOracle,
      accessControlConfig,
      mockedPcsFactory,
      mockedPancakePair,
      mockedStdReference,
      bnbVault,
      wbnb,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])
  })

  context("#ibTokenPriceFeed.peekPrice()", () => {
    context("when every component operates normally", () => {
      it("ibTokenPriceFeed1 should returns price with status ok=true", async () => {
        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        const now = DateTime.now()
        // mock reserve 1 WBNB = 400 BUSD
        mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
        // mock chainlink oracle to return 1 WBNB = 401 BUSD
        mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
        // mock simple oracle to return 1 ibWBNB = 1.1 BNB
        mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

        await ibTokenPriceFeed1.setPrice()

        const { calls: chainlinkCalls } = mockedChainLinkOracle.smocked.getPrice
        expect(chainlinkCalls.length).to.be.equal(1)
        expect(chainlinkCalls[0][0]).to.be.equal(wbnbAddress) // token0
        expect(chainlinkCalls[0][1]).to.be.equal(busdAddress) // token1

        const { calls: simpleCalls } = mockedSimpleOracle.smocked.getPrice
        expect(simpleCalls.length).to.be.equal(1)
        expect(simpleCalls[0][0]).to.be.equal(ibWBNBAddress) // token0
        expect(simpleCalls[0][1]).to.be.equal(wbnbAddress) // token1

        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        await ibTokenPriceFeed1.setPrice()

        const [price, ok] = await ibTokenPriceFeed1.peekPrice()
        expect(BigNumber.from(price)).to.be.equal(parseEther("441.1")) // 401 * 1.1
        expect(ok).to.be.true
      })
      it("ibTokenPriceFeed2 should returns price with status ok=true", async () => {
        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        const now = DateTime.now()
        // mock chainlink oracle to return 1 WBNB = 401 BUSD
        mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
        // mock chainlink oracle to return 1 WBNB = 401 BUSD
        mockedStdReference.smocked.getReferenceData.will.return.with({
          rate: parseEther("401"),
          lastUpdatedBase: nHoursAgoInSec(now, 1),
          lastUpdatedQuote: nHoursAgoInSec(now, 1),
        })
        // mock simple oracle to return 1 ibWBNB = 1.1 BNB
        mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

        await ibTokenPriceFeed2.setPrice()

        const { calls: chainlinkCalls } = mockedChainLinkOracle.smocked.getPrice

        expect(chainlinkCalls.length).to.be.equal(1)
        expect(chainlinkCalls[0][0]).to.be.equal(wbnbAddress) // token0
        expect(chainlinkCalls[0][1]).to.be.equal(busdAddress) // token1

        const { calls: simpleCalls } = mockedSimpleOracle.smocked.getPrice
        expect(simpleCalls.length).to.be.equal(1)
        expect(simpleCalls[0][0]).to.be.equal(ibWBNBAddress) // token0
        expect(simpleCalls[0][1]).to.be.equal(wbnbAddress) // token1

        const { calls: stdReferenceCalls } = mockedStdReference.smocked.getReferenceData
        expect(stdReferenceCalls.length).to.be.equal(1)
        expect(stdReferenceCalls[0][0]).to.be.equal("BNB") // token0
        expect(stdReferenceCalls[0][1]).to.be.equal("BUSD") // token1

        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        await ibTokenPriceFeed2.setPrice()
        const [price, ok] = await ibTokenPriceFeed2.peekPrice()
        expect(BigNumber.from(price)).to.be.equal(parseEther("441.1")) // 401 * 1.1
        expect(ok).to.be.true
      })
      it("ibTokenPriceFeed3 should returns price with status ok=true", async () => {
        await wbnb.transfer(bnbVault.address, parseEther("0.1"))
        await simplePriceOracle.setPrices([bnbVault.address], [wbnb.address], [parseEther("1.1")])

        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        await ibTokenPriceFeed3.setPrice()

        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        await ibTokenPriceFeed3.setPrice()
        const [price, ok] = await ibTokenPriceFeed3.peekPrice()
        expect(BigNumber.from(price)).to.be.equal(parseEther("441.1")) // 401 * 1.1
        expect(ok).to.be.true
      })
    })
    context("when ibWBNB to WBNB price source (mockedSimpleOracle)...", () => {
      context("set 25 hours old price", () => {
        it("should be revert", async () => {
          TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 25)])

          await expect(ibTokenPriceFeed1.setPrice()).to.be.revertedWith("IbTokenPriceFeed/not-ok")
        })
      })
      context("returns 20 hours old price, but ibInWbnbPriceFeed's price life is set to 21 hours", () => {
        it("should returns price with status ok=true", async () => {
          TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 20)])

          // set price life to 21 hours
          await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)
          await ibInWbnbPriceFeed.setPriceLife(21 * 60 * 60)

          await ibTokenPriceFeed1.setPrice()
          TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
          await ibTokenPriceFeed1.setPrice()
          const [price, ok] = await ibTokenPriceFeed1.peekPrice()
          expect(BigNumber.from(price)).to.be.equal(parseEther("441.1")) // 401 * 1.1
          expect(ok).to.be.true
        })
      })
    })

    context("when WBNB to BUSD primary price source (chainlinkPriceOracle)...", () => {
      context("set 25 hours old price", () => {
        it("should be revert", async () => {
          TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 25)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          await expect(ibTokenPriceFeed1.setPrice()).to.be.revertedWith("IbTokenPriceFeed/not-ok")
        })
      })

      context("returns 22 hours old price, but strictWbnbInBusdPriceFeed's price life is set to 23 hours", () => {
        it("should returns price with status ok=true", async () => {
          TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 22)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          // set price life to 23 hours
          await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)
          await strictWbnbInBusdPriceFeed1.setPriceLife(23 * 60 * 60)

          await ibTokenPriceFeed1.setPrice()
          TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
          await ibTokenPriceFeed1.setPrice()
          const [price, ok] = await ibTokenPriceFeed1.peekPrice()
          expect(BigNumber.from(price)).to.be.equal(parseEther("441.1")) // 401 * 1.1
          expect(ok).to.be.true
        })
      })

      context("set price in which 5% higher than dex", () => {
        it("should be revert", async () => {
          TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([
            parseEther("420.000000000000000001"),
            nHoursAgoInSec(now, 1),
          ])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          await expect(ibTokenPriceFeed1.setPrice()).to.be.revertedWith("IbTokenPriceFeed/not-ok")
        })
      })

      context("set price in which 5% lower than dex", () => {
        it("should be revert", async () => {
          TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("380"), nHoursAgoInSec(now, 1)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          await expect(ibTokenPriceFeed1.setPrice()).to.be.revertedWith("IbTokenPriceFeed/not-ok")
        })
      })
    })
    context("when ibInWbnbPriceFeed...", () => {
      context("is in paused state", () => {
        it("should be revert", async () => {
          TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          // pause
          await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)
          await ibInWbnbPriceFeed.pause()

          await expect(ibTokenPriceFeed1.setPrice()).to.be.revertedWith("IbTokenPriceFeed/not-ok")
        })
      })
    })
    context("when strictWbnbInBusdPriceFeed...", () => {
      context("is in paused state", () => {
        it("should be revert", async () => {
          TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          // pause
          await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)
          await strictWbnbInBusdPriceFeed1.pause()

          await expect(ibTokenPriceFeed1.setPrice()).to.be.revertedWith("IbTokenPriceFeed/not-ok")
        })
      })
    })
    context("when IbTokenPriceFeed...", () => {
      context("is in paused state", () => {
        it("should be revert", async () => {
          TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          // pause
          await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)
          await ibTokenPriceFeed1.pause()

          await expect(ibTokenPriceFeed1.setPrice()).to.be.reverted
        })
      })
    })

    context("when IbTokenPriceFeed setPrice before time delay passed", () => {
      it("should revert", async () => {
        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        const now = DateTime.now()
        // mock reserve 1 WBNB = 400 BUSD
        mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
        // mock chainlink oracle to return 1 WBNB = 401 BUSD
        mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
        // mock simple oracle to return 1 ibWBNB = 1.1 BNB
        mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

        await ibTokenPriceFeed1.setPrice()
        TimeHelpers.increase(BigNumber.from(10))
        await expect(ibTokenPriceFeed1.setPrice()).to.be.revertedWith("IbTokenPriceFeed/time-delay-has-not-passed")
      })
    })

    context("when IbTokenPriceFeed still use previous price because time delay has not passed", () => {
      it("should return the same price", async () => {
        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        const now = DateTime.now()
        // mock reserve 1 WBNB = 400 BUSD
        mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
        // mock chainlink oracle to return 1 WBNB = 401 BUSD
        mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
        // mock simple oracle to return 1 ibWBNB = 1.1 BNB
        mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

        await ibTokenPriceFeed1.setPrice()
        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))

        await ibTokenPriceFeed1.setPrice()
        const [price, ok] = await ibTokenPriceFeed1.peekPrice()
        expect(BigNumber.from(price)).to.be.eq(parseEther("441.1"))
        expect(ok).to.be.eq(true)

        TimeHelpers.increase(BigNumber.from(50))
        mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("420"), nHoursAgoInSec(now, 1)])
        const [price2, ok2] = await ibTokenPriceFeed1.peekPrice()
        expect(BigNumber.from(price2)).to.be.eq(parseEther("441.1"))
        expect(ok2).to.be.eq(true)
      })
    })

    context("when IbTokenPriceFeed has advanced to the next price", () => {
      it("should return the next price", async () => {
        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        const now = DateTime.now()
        // mock reserve 1 WBNB = 400 BUSD
        mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
        // mock chainlink oracle to return 1 WBNB = 401 BUSD
        mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
        // mock simple oracle to return 1 ibWBNB = 1.1 BNB
        mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

        await ibTokenPriceFeed1.setPrice()
        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("420"), nHoursAgoInSec(now, 1)])
        await ibTokenPriceFeed1.setPrice()
        const [price, ok] = await ibTokenPriceFeed1.peekPrice()
        expect(BigNumber.from(price)).to.be.eq(parseEther("441.1"))
        expect(ok).to.be.eq(true)

        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        await ibTokenPriceFeed1.setPrice()
        const [price2, ok2] = await ibTokenPriceFeed1.peekPrice()
        expect(BigNumber.from(price2)).to.be.eq(parseEther("462"))
        expect(ok2).to.be.eq(true)
      })
    })

    context("when IbTokenPriceFeed new price is not ok", () => {
      it("should return the previos price", async () => {
        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        const now = DateTime.now()
        // mock reserve 1 WBNB = 400 BUSD
        mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
        // mock chainlink oracle to return 1 WBNB = 401 BUSD
        mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
        // mock simple oracle to return 1 ibWBNB = 1.1 BNB
        mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

        await ibTokenPriceFeed1.setPrice()
        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        await ibTokenPriceFeed1.setPrice()
        const [price, ok] = await ibTokenPriceFeed1.peekPrice()
        expect(BigNumber.from(price)).to.be.eq(parseEther("441.1"))
        expect(ok).to.be.eq(true)

        mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("820"), nHoursAgoInSec(now, 1)])
        TimeHelpers.increase(BigNumber.from(ORACLE_TIME_DELAY))
        await expect(ibTokenPriceFeed1.setPrice()).to.be.revertedWith("IbTokenPriceFeed/not-ok")
      })
    })
  })

  context("#StrictAlpacaOraclePriceFeed.setPrimary()", () => {
    context("set primary correctly", () => {
      it("should success", async () => {
        await strictWbnbInBusdPriceFeed1.setPrimary(dexPriceOracle.address, wbnbAddress, busdAddress)

        const newPrimary = await strictWbnbInBusdPriceFeed1.primary()
        expect(newPrimary.alpacaOracle).to.be.equal(dexPriceOracle.address)
        expect(newPrimary.token0).to.be.equal(wbnbAddress)
        expect(newPrimary.token1).to.be.equal(busdAddress)
      })
    })

    context("set primary incorrectly", () => {
      it("should revert", async () => {
        await expect(strictWbnbInBusdPriceFeed1.setPrimary(wbnbAddress, wbnbAddress, busdAddress)).to.be.reverted
      })
    })
  })

  context("#StrictAlpacaOraclePriceFeed.setSecondary()", () => {
    context("set secondary correctly", () => {
      it("should success", async () => {
        await strictWbnbInBusdPriceFeed2.setSecondary(mockedChainLinkOracle.address, wbnbAddress, busdAddress)

        const newSecondary = await strictWbnbInBusdPriceFeed2.secondary()
        expect(newSecondary.alpacaOracle).to.be.equal(mockedChainLinkOracle.address)
        expect(newSecondary.token0).to.be.equal(wbnbAddress)
        expect(newSecondary.token1).to.be.equal(busdAddress)
      })
    })

    context("set secondary incorrectly", () => {
      it("should revert", async () => {
        await expect(strictWbnbInBusdPriceFeed2.setSecondary(wbnbAddress, wbnbAddress, busdAddress)).to.be.reverted
      })
    })
  })
})
