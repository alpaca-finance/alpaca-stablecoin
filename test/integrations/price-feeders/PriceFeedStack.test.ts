/*
┌─────────────────┐         ┌──────────────────────────┐
│SimplePriceOracle├────────►│AlpacaPriceOraclePriceFeed├──────────┐
└──ib/base────────┘         └───ib/base────────────────┘          ▼
                                                                ┌────────────────┐
┌────────────────────┐                                          │IbTokenPriceFeed│
│ChainLinkPriceOracle├───────┐                                  └────ib/BUSD─────┘
└──base/BUSD─────────┘       ▼                                    ▲
                            ┌────────────────────────────────┐    │
                            │StrictAlpacaPriceOraclePriceFeed├────┘
                            └───base/BUSD────────────────────┘
┌──────────────┐             ▲
│DexPriceOracle├─────────────┘
└──base/BUSD───┘
*/

import { PancakeFactory__factory, PancakePair__factory } from "@alpaca-finance/alpaca-contract/typechain"
import { MockContract, smockit } from "@eth-optimism/smock"
import { BigNumber } from "@ethersproject/bignumber"
import { expect } from "chai"
import { MockProvider } from "ethereum-waffle"
import { Signer, Wallet } from "ethers"
import { parseEther } from "ethers/lib/utils"
import { ethers, upgrades, waffle } from "hardhat"
import { DateTime } from "luxon"
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
} from "../../../typechain"
import { AddressFour, AddressOne, AddressThree, AddressTwo, AddressZero } from "../../helper/address"

type fixture = {
  strictWbnbInBusdPriceFeed: StrictAlpacaOraclePriceFeed
  ibInWbnbPriceFeed: AlpacaOraclePriceFeed
  dexPriceOracle: DexPriceOracle // use as base/busd price source actual (secondary source)
  ibTokenPriceFeed: IbTokenPriceFeed
  accessControlConfig: AccessControlConfig
  mockedSimpleOracle: MockContract // use as ib/base price source
  mockedChainLinkOracle: MockContract // use as base/busd price source actual (primary source)
  mockedPcsFactory: MockContract
  mockedPancakePair: MockContract
}

const ibWBNBAddress = AddressOne
const wbnbAddress = AddressTwo
const busdAddress = AddressThree
const usdAddress = AddressFour

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
  const strictWbnbInBusdPriceFeed = (await upgrades.deployProxy(StrictAlpacaOraclePriceFeed, [
    mockedChainLinkOracle.address,
    wbnbAddress,
    busdAddress,
    dexPriceOracle.address,
    wbnbAddress,
    busdAddress,
    accessControlConfig.address,
  ])) as StrictAlpacaOraclePriceFeed
  await strictWbnbInBusdPriceFeed.deployed()

  // reset ocked for StrictAlpacaOraclePriceFeed sanity check
  mockedChainLinkOracle.smocked.getPrice.reset()
  mockedPancakePair.smocked.getReserves.reset()

  // Deploy IbTokenPriceFeed
  const IbTokenPriceFeed = (await ethers.getContractFactory("IbTokenPriceFeed", deployer)) as IbTokenPriceFeed__factory
  const ibTokenPriceFeed = (await upgrades.deployProxy(IbTokenPriceFeed, [
    ibInWbnbPriceFeed.address,
    strictWbnbInBusdPriceFeed.address,
    accessControlConfig.address,
  ])) as IbTokenPriceFeed
  await ibTokenPriceFeed.deployed()

  return {
    strictWbnbInBusdPriceFeed,
    ibInWbnbPriceFeed,
    ibTokenPriceFeed,
    dexPriceOracle,
    mockedSimpleOracle,
    mockedChainLinkOracle,
    accessControlConfig,
    mockedPcsFactory,
    mockedPancakePair,
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

  let strictWbnbInBusdPriceFeed: StrictAlpacaOraclePriceFeed
  let ibInWbnbPriceFeed: AlpacaOraclePriceFeed
  let ibTokenPriceFeed: IbTokenPriceFeed
  let dexPriceOracle: DexPriceOracle
  let accessControlConfig: AccessControlConfig
  let mockedSimpleOracle: MockContract
  let mockedChainLinkOracle: MockContract
  let mockedPcsFactory: MockContract
  let mockedPancakePair: MockContract

  beforeEach(async () => {
    ;({
      strictWbnbInBusdPriceFeed,
      ibInWbnbPriceFeed,
      ibTokenPriceFeed,
      dexPriceOracle,
      mockedSimpleOracle,
      mockedChainLinkOracle,
      accessControlConfig,
      mockedPcsFactory,
      mockedPancakePair,
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
      it("should returns price with status ok=true", async () => {
        const now = DateTime.now()
        // mock reserve 1 WBNB = 400 BUSD
        mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
        // mock chainlink oracle to return 1 WBNB = 401 BUSD
        mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
        // mock simple oracle to return 1 ibWBNB = 1.1 BNB
        mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

        const [price, ok] = await ibTokenPriceFeed.peekPrice()
        expect(BigNumber.from(price)).to.be.equal(parseEther("441.1")) // 401 * 1.1
        expect(ok).to.be.true

        const { calls: chainlinkCalls } = mockedChainLinkOracle.smocked.getPrice
        expect(chainlinkCalls.length).to.be.equal(1)
        expect(chainlinkCalls[0][0]).to.be.equal(wbnbAddress) // token0
        expect(chainlinkCalls[0][1]).to.be.equal(busdAddress) // token1

        const { calls: simpleCalls } = mockedChainLinkOracle.smocked.getPrice
        expect(simpleCalls.length).to.be.equal(1)
        expect(simpleCalls[0][0]).to.be.equal(wbnbAddress) // token0
        expect(simpleCalls[0][1]).to.be.equal(busdAddress) // token1
      })
    })
    context("when ibWBNB to WBNB price source (mockedSimpleOracle)...", () => {
      context("returns 25 hours old price", () => {
        it("should returns price with status ok=false", async () => {
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 25)])

          const [price, ok] = await ibTokenPriceFeed.peekPrice()
          expect(BigNumber.from(price)).to.be.equal(parseEther("441.1")) // 401 * 1.1
          expect(ok).to.be.false
        })
      })
      context("returns 25 hours old price, but ibInWbnbPriceFeed's price life is set to 26 hours", () => {
        it("should returns price with status ok=true", async () => {
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 25)])

          // set price life to 26 hours
          await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)
          await ibInWbnbPriceFeed.setPriceLife(26 * 60 * 60)

          const [price, ok] = await ibTokenPriceFeed.peekPrice()
          expect(BigNumber.from(price)).to.be.equal(parseEther("441.1")) // 401 * 1.1
          expect(ok).to.be.true
        })
      })
    })

    context("when WBNB to BUSD primary price source (chainlinkPriceOracle)...", () => {
      context("returns 25 hours old price", () => {
        it("should returns price with status ok=false", async () => {
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 25)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          const [price, ok] = await ibTokenPriceFeed.peekPrice()
          expect(BigNumber.from(price)).to.be.equal(parseEther("441.1")) // 401 * 1.1
          expect(ok).to.be.false
        })
      })

      context("returns 25 hours old price, but strictWbnbInBusdPriceFeed's price life is set to 26 hours", () => {
        it("should returns price with status ok=true", async () => {
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 25)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          // set price life to 26 hours
          await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)
          await strictWbnbInBusdPriceFeed.setPriceLife(26 * 60 * 60)

          const [price, ok] = await ibTokenPriceFeed.peekPrice()
          expect(BigNumber.from(price)).to.be.equal(parseEther("441.1")) // 401 * 1.1
          expect(ok).to.be.true
        })
      })

      context("returns price in which 5% higher than dex", () => {
        it("should returns price with status ok=false", async () => {
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([
            parseEther("420.000000000000000001"),
            nHoursAgoInSec(now, 1),
          ])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          const [price, ok] = await ibTokenPriceFeed.peekPrice()
          expect(BigNumber.from(price)).to.be.equal(parseEther("462.000000000000000001")) // 420 * 1.1
          expect(ok).to.be.false
        })
      })

      context("returns price in which 5% lower than dex", () => {
        it("should returns price with status ok=false", async () => {
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("380"), nHoursAgoInSec(now, 1)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          const [price, ok] = await ibTokenPriceFeed.peekPrice()
          expect(BigNumber.from(price)).to.be.equal(parseEther("418")) // 380 * 1.1
          expect(ok).to.be.false
        })
      })
    })
    context("when ibInWbnbPriceFeed...", () => {
      context("is in paused state", () => {
        it("should returns price with status ok=false", async () => {
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          // pause
          await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)
          await ibInWbnbPriceFeed.pause()

          const [price, ok] = await ibTokenPriceFeed.peekPrice()
          expect(BigNumber.from(price)).to.be.equal(parseEther("441.1")) // 401 * 1.1
          expect(ok).to.be.false
        })
      })
    })
    context("when strictWbnbInBusdPriceFeed...", () => {
      context("is in paused state", () => {
        it("should returns price with status ok=false", async () => {
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          // pause
          await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)
          await strictWbnbInBusdPriceFeed.pause()

          const [price, ok] = await ibTokenPriceFeed.peekPrice()
          expect(BigNumber.from(price)).to.be.equal(parseEther("441.1")) // 401 * 1.1
          expect(ok).to.be.false
        })
      })
    })
    context("when IbTokenPriceFeed...", () => {
      context("is in paused state", () => {
        it("should returns price with status ok=false", async () => {
          const now = DateTime.now()
          mockedPancakePair.smocked.getReserves.will.return.with([parseEther("400"), parseEther("1"), 0])
          mockedChainLinkOracle.smocked.getPrice.will.return.with([parseEther("401"), nHoursAgoInSec(now, 1)])
          mockedSimpleOracle.smocked.getPrice.will.return.with([parseEther("1.1"), nHoursAgoInSec(now, 1)])

          // pause
          await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)
          await ibTokenPriceFeed.pause()

          const [price, ok] = await ibTokenPriceFeed.peekPrice()
          expect(BigNumber.from(price)).to.be.equal(parseEther("441.1")) // 401 * 1.1
          expect(ok).to.be.false
        })
      })
    })
  })
})
