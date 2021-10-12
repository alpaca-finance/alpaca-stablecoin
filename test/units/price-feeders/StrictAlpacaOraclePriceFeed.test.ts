import { ethers, upgrades, waffle } from "hardhat"
import { BigNumber, Signer, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import {
  StrictAlpacaOraclePriceFeed,
  StrictAlpacaOraclePriceFeed__factory,
  MockAlpacaOracle__factory,
  MockAlpacaOracle,
} from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"
import { AddressOne, AddressTwo } from "../../helper/address"
import { WeiPerWad } from "../../helper/unit"
import { DateTime } from "luxon"

chai.use(solidity)
const { expect } = chai
type fixture = {
  strictAlpacaOraclePriceFeed: StrictAlpacaOraclePriceFeed
  mockedAlpacaOracleA: MockContract
  mockedAlpacaOracleB: MockContract
}

const token0Address = AddressOne
const token1Address = AddressTwo

const nHoursAgoInSec = (now: DateTime, n: number): BigNumber => {
  const d = now.minus({ hours: n })
  return BigNumber.from(Math.floor(d.toSeconds()))
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked AlpacaOracle
  const MockAlpacaOracle = (await ethers.getContractFactory("MockAlpacaOracle", deployer)) as MockAlpacaOracle__factory

  const mockAlpacaOracleA = (await upgrades.deployProxy(MockAlpacaOracle, [])) as MockAlpacaOracle
  await mockAlpacaOracleA.deployed()
  const mockedAlpacaOracleA = await smockit(mockAlpacaOracleA)

  const mockAlpacaOracleB = (await upgrades.deployProxy(MockAlpacaOracle, [])) as MockAlpacaOracle
  await mockAlpacaOracleB.deployed()
  const mockedAlpacaOracleB = await smockit(mockAlpacaOracleA)

  // Deploy StrictAlpacaOraclePriceFeed
  const StrictAlpacaOraclePriceFeed = (await ethers.getContractFactory(
    "StrictAlpacaOraclePriceFeed",
    deployer
  )) as StrictAlpacaOraclePriceFeed__factory
  const strictAlpacaOraclePriceFeed = (await upgrades.deployProxy(StrictAlpacaOraclePriceFeed, [
    mockedAlpacaOracleA.address,
    token0Address,
    token1Address,
    mockedAlpacaOracleB.address,
    token0Address,
    token1Address,
  ])) as StrictAlpacaOraclePriceFeed
  await strictAlpacaOraclePriceFeed.deployed()

  return { strictAlpacaOraclePriceFeed, mockedAlpacaOracleA, mockedAlpacaOracleB }
}

describe("StrictAlpacaOraclePriceFeed", () => {
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
  let strictAlpacaOraclePriceFeed: StrictAlpacaOraclePriceFeed
  let mockedAlpacaOracleA: MockContract
  let mockedAlpacaOracleB: MockContract
  let alpacaOraclePriceFeedAsAlice: StrictAlpacaOraclePriceFeed
  let alpacaOraclePriceFeedAsBob: StrictAlpacaOraclePriceFeed

  beforeEach(async () => {
    ;({ strictAlpacaOraclePriceFeed, mockedAlpacaOracleA, mockedAlpacaOracleB } = await waffle.loadFixture(
      loadFixtureHandler
    ))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])

    alpacaOraclePriceFeedAsAlice = StrictAlpacaOraclePriceFeed__factory.connect(
      strictAlpacaOraclePriceFeed.address,
      alice
    ) as StrictAlpacaOraclePriceFeed
    alpacaOraclePriceFeedAsBob = StrictAlpacaOraclePriceFeed__factory.connect(
      strictAlpacaOraclePriceFeed.address,
      bob
    ) as StrictAlpacaOraclePriceFeed
  })

  describe("#peekPrice()", () => {
    const assertGetPriceCall = (calls: any[]) => {
      expect(calls.length).to.be.equal(1)
      expect(calls[0][0]).to.be.equal(token0Address)
      expect(calls[0][1]).to.be.equal(token1Address)
    }

    context("when priceLife is 24 hours", () => {
      context("when primary alpacaOracle returns 25 hours old price", () => {
        it("should be able to get price with okFlag = false, with price from primary", async () => {
          const now = DateTime.now()

          mockedAlpacaOracleA.smocked.getPrice.will.return.with([WeiPerWad.mul(100), nHoursAgoInSec(now, 25)])
          mockedAlpacaOracleB.smocked.getPrice.will.return.with([WeiPerWad.mul(99), nHoursAgoInSec(now, 1)])

          const [price, ok] = await strictAlpacaOraclePriceFeed.peekPrice()
          expect(price).to.be.equal(WeiPerWad.mul(100))
          expect(ok).to.be.false

          assertGetPriceCall(mockedAlpacaOracleA.smocked.getPrice.calls)
          assertGetPriceCall(mockedAlpacaOracleB.smocked.getPrice.calls)
        })
      })
      context("when secondary alpacaOracle returns 25 hours old price", () => {
        it("should be able to get price with okFlag = false, with price from primary", async () => {
          const now = DateTime.now()

          mockedAlpacaOracleA.smocked.getPrice.will.return.with([WeiPerWad.mul(100), nHoursAgoInSec(now, 1)])
          mockedAlpacaOracleB.smocked.getPrice.will.return.with([WeiPerWad.mul(99), nHoursAgoInSec(now, 25)])

          const [price, ok] = await strictAlpacaOraclePriceFeed.peekPrice()
          expect(price).to.be.equal(WeiPerWad.mul(100))
          expect(ok).to.be.false

          assertGetPriceCall(mockedAlpacaOracleA.smocked.getPrice.calls)
          assertGetPriceCall(mockedAlpacaOracleB.smocked.getPrice.calls)
        })
      })
      context("when both alpacaOracle returns 1 hours old price", () => {
        it("should be able to get price with okFlag = true, with price from primary", async () => {
          const now = DateTime.now()

          mockedAlpacaOracleA.smocked.getPrice.will.return.with([WeiPerWad.mul(100), nHoursAgoInSec(now, 1)])
          mockedAlpacaOracleB.smocked.getPrice.will.return.with([WeiPerWad.mul(99), nHoursAgoInSec(now, 1)])

          const [price, ok] = await strictAlpacaOraclePriceFeed.peekPrice()
          expect(price).to.be.equal(WeiPerWad.mul(100))
          expect(ok).to.be.true

          assertGetPriceCall(mockedAlpacaOracleA.smocked.getPrice.calls)
          assertGetPriceCall(mockedAlpacaOracleB.smocked.getPrice.calls)
        })
      })
    })
    context("when maxPriceDiff is 10500 (5%)", () => {
      context("when primary returns price = 100 WAD, secondary returns price = 106 WAD (diff -6%)", () => {
        it("should be able to get price with okFlag = false (primary price too low)", async () => {
          const now = DateTime.now()

          mockedAlpacaOracleA.smocked.getPrice.will.return.with([WeiPerWad.mul(100), nHoursAgoInSec(now, 1)])
          mockedAlpacaOracleB.smocked.getPrice.will.return.with([WeiPerWad.mul(106), nHoursAgoInSec(now, 1)])

          const [price, ok] = await strictAlpacaOraclePriceFeed.peekPrice()
          expect(price).to.be.equal(WeiPerWad.mul(100))
          expect(ok).to.be.false

          assertGetPriceCall(mockedAlpacaOracleA.smocked.getPrice.calls)
          assertGetPriceCall(mockedAlpacaOracleB.smocked.getPrice.calls)
        })
      })
      context("when primary returns price = 106 WAD, secondary returns price = 100 WAD (diff +6%)", () => {
        it("should be able to get price with okFlag = false (primary price too high)", async () => {
          const now = DateTime.now()

          mockedAlpacaOracleA.smocked.getPrice.will.return.with([WeiPerWad.mul(106), nHoursAgoInSec(now, 1)])
          mockedAlpacaOracleB.smocked.getPrice.will.return.with([WeiPerWad.mul(100), nHoursAgoInSec(now, 1)])

          const [price, ok] = await strictAlpacaOraclePriceFeed.peekPrice()
          expect(price).to.be.equal(WeiPerWad.mul(106))
          expect(ok).to.be.false

          assertGetPriceCall(mockedAlpacaOracleA.smocked.getPrice.calls)
          assertGetPriceCall(mockedAlpacaOracleB.smocked.getPrice.calls)
        })
      })
      context("when primary returns price = 100 WAD, secondary returns price = 105 WAD (diff -5%)", () => {
        it("should be able to get price with okFlag = true", async () => {
          const now = DateTime.now()

          mockedAlpacaOracleA.smocked.getPrice.will.return.with([WeiPerWad.mul(100), nHoursAgoInSec(now, 1)])
          mockedAlpacaOracleB.smocked.getPrice.will.return.with([WeiPerWad.mul(105), nHoursAgoInSec(now, 1)])

          const [price, ok] = await strictAlpacaOraclePriceFeed.peekPrice()
          expect(price).to.be.equal(WeiPerWad.mul(100))
          expect(ok).to.be.true

          assertGetPriceCall(mockedAlpacaOracleA.smocked.getPrice.calls)
          assertGetPriceCall(mockedAlpacaOracleB.smocked.getPrice.calls)
        })
      })
      context("when primary returns price = 105 WAD, secondary returns price = 100 WAD (diff +5%)", () => {
        it("should be able to get price with okFlag = true", async () => {
          const now = DateTime.now()

          mockedAlpacaOracleA.smocked.getPrice.will.return.with([WeiPerWad.mul(105), nHoursAgoInSec(now, 1)])
          mockedAlpacaOracleB.smocked.getPrice.will.return.with([WeiPerWad.mul(100), nHoursAgoInSec(now, 1)])

          const [price, ok] = await strictAlpacaOraclePriceFeed.peekPrice()
          expect(price).to.be.equal(WeiPerWad.mul(105))
          expect(ok).to.be.true

          assertGetPriceCall(mockedAlpacaOracleA.smocked.getPrice.calls)
          assertGetPriceCall(mockedAlpacaOracleB.smocked.getPrice.calls)
        })
      })
    })
    context("when in paused state", () => {
      it("should be able to get price with okFlag = false", async () => {
        // pause
        await strictAlpacaOraclePriceFeed.pause()

        const now = DateTime.now()

        mockedAlpacaOracleA.smocked.getPrice.will.return.with([WeiPerWad.mul(100), nHoursAgoInSec(now, 1)])
        mockedAlpacaOracleB.smocked.getPrice.will.return.with([WeiPerWad.mul(99), nHoursAgoInSec(now, 1)])

        const [price, ok] = await strictAlpacaOraclePriceFeed.peekPrice()
        expect(price).to.be.equal(WeiPerWad.mul(100))
        expect(ok).to.be.false

        assertGetPriceCall(mockedAlpacaOracleA.smocked.getPrice.calls)
        assertGetPriceCall(mockedAlpacaOracleB.smocked.getPrice.calls)
      })
    })
  })
})
