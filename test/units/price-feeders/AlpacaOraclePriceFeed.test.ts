import { ethers, upgrades, waffle } from "hardhat"
import { BigNumber, Signer, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import {
  AlpacaOraclePriceFeed,
  AlpacaOraclePriceFeed__factory,
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
  alpacaOraclePriceFeed: AlpacaOraclePriceFeed
  mockedAlpacaOracle: MockContract
}

const token0Address = AddressOne
const token1Address = AddressTwo

const nHoursAgoInSec = (now: DateTime, n: number): BigNumber => {
  const d = now.minus({ hours: n })
  return BigNumber.from(Math.floor(d.toSeconds()))
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const MockAlpacaOracle = (await ethers.getContractFactory("MockAlpacaOracle", deployer)) as MockAlpacaOracle__factory
  const mockAlpacaOracle = (await upgrades.deployProxy(MockAlpacaOracle, [])) as MockAlpacaOracle
  await mockAlpacaOracle.deployed()
  const mockedAlpacaOracle = await smockit(mockAlpacaOracle)

  // Deploy AlpacaOraclePriceFeed
  const AlpacaOraclePriceFeed = (await ethers.getContractFactory(
    "AlpacaOraclePriceFeed",
    deployer
  )) as AlpacaOraclePriceFeed__factory
  const alpacaOraclePriceFeed = (await upgrades.deployProxy(AlpacaOraclePriceFeed, [
    mockedAlpacaOracle.address,
    token0Address,
    token1Address,
  ])) as AlpacaOraclePriceFeed
  await alpacaOraclePriceFeed.deployed()

  return { alpacaOraclePriceFeed, mockedAlpacaOracle }
}

describe("AlpacaOraclePriceFeed", () => {
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
  let alpacaOraclePriceFeed: AlpacaOraclePriceFeed
  let mockedAlpacaOracle: MockContract
  let alpacaOraclePriceFeedAsAlice: AlpacaOraclePriceFeed
  let alpacaOraclePriceFeedAsBob: AlpacaOraclePriceFeed

  beforeEach(async () => {
    ;({ alpacaOraclePriceFeed, mockedAlpacaOracle } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])

    alpacaOraclePriceFeedAsAlice = AlpacaOraclePriceFeed__factory.connect(
      alpacaOraclePriceFeed.address,
      alice
    ) as AlpacaOraclePriceFeed
    alpacaOraclePriceFeedAsBob = AlpacaOraclePriceFeed__factory.connect(
      alpacaOraclePriceFeed.address,
      bob
    ) as AlpacaOraclePriceFeed
  })

  describe("#peekPrice()", () => {
    context("when priceLife is 24 hours", () => {
      context("when alpacaOracle returns 25 hours old price", () => {
        it("should be able to get price with okFlag = false", async () => {
          const now = DateTime.now()

          mockedAlpacaOracle.smocked.getPrice.will.return.with([WeiPerWad.mul(10), nHoursAgoInSec(now, 25)])

          const [price, ok] = await alpacaOraclePriceFeed.peekPrice()
          expect(price).to.be.equal(WeiPerWad.mul(10))
          expect(ok).to.be.false

          const { calls } = mockedAlpacaOracle.smocked.getPrice
          expect(calls.length).to.be.equal(1)
          expect(calls[0][0]).to.be.equal(token0Address)
          expect(calls[0][1]).to.be.equal(token1Address)
        })
      })
      context("when alpacaOracle returns 23 hours old price", () => {
        it("should be able to get price with okFlag = true", async () => {
          const now = DateTime.now()

          mockedAlpacaOracle.smocked.getPrice.will.return.with([WeiPerWad.mul(10), nHoursAgoInSec(now, 23)])

          const [price, ok] = await alpacaOraclePriceFeed.peekPrice()
          expect(price).to.be.equal(WeiPerWad.mul(10))
          expect(ok).to.be.true

          const { calls } = mockedAlpacaOracle.smocked.getPrice
          expect(calls.length).to.be.equal(1)
          expect(calls[0][0]).to.be.equal(token0Address)
          expect(calls[0][1]).to.be.equal(token1Address)
        })
      })
    })
    context("when priceLife is 2 hour", () => {
      context("when alpacaOracle returns 3 hour old price", () => {
        it("should be able to get price with okFlag = false", async () => {
          const now = DateTime.now()

          mockedAlpacaOracle.smocked.getPrice.will.return.with([WeiPerWad.mul(10), nHoursAgoInSec(now, 3)])

          await alpacaOraclePriceFeed.setPriceLife(2 * 60 * 60)
          const [price, ok] = await alpacaOraclePriceFeed.peekPrice()
          expect(price).to.be.equal(WeiPerWad.mul(10))
          expect(ok).to.be.false

          const { calls } = mockedAlpacaOracle.smocked.getPrice
          expect(calls.length).to.be.equal(1)
          expect(calls[0][0]).to.be.equal(token0Address)
          expect(calls[0][1]).to.be.equal(token1Address)
        })
      })
      context("when alpacaOracle returns 1 hours old price", () => {
        it("should be able to get price with okFlag = true", async () => {
          const now = DateTime.now()
          mockedAlpacaOracle.smocked.getPrice.will.return.with([WeiPerWad.mul(10), nHoursAgoInSec(now, 1)])

          await alpacaOraclePriceFeed.setPriceLife(2 * 60 * 60)
          const [price, ok] = await alpacaOraclePriceFeed.peekPrice()
          expect(price).to.be.equal(WeiPerWad.mul(10))
          expect(ok).to.be.true

          const { calls } = mockedAlpacaOracle.smocked.getPrice
          expect(calls.length).to.be.equal(1)
          expect(calls[0][0]).to.be.equal(token0Address)
          expect(calls[0][1]).to.be.equal(token1Address)
        })
      })
    })

    context("when AlpacaOraclePriceFeed is in paused state", () => {
      it("should always return okFlag = false no matter what the alpacaOracle says", async () => {
        // return the price with last update nearly to present
        const now = DateTime.now()
        mockedAlpacaOracle.smocked.getPrice.will.return.with([WeiPerWad.mul(10), nHoursAgoInSec(now, 0)])

        await alpacaOraclePriceFeed.pause()
        const [price, ok] = await alpacaOraclePriceFeed.peekPrice()
        expect(price).to.be.equal(WeiPerWad.mul(10))
        expect(ok).to.be.false

        const { calls } = mockedAlpacaOracle.smocked.getPrice
        expect(calls.length).to.be.equal(1)
        expect(calls[0][0]).to.be.equal(token0Address)
        expect(calls[0][1]).to.be.equal(token1Address)
      })
    })
  })
  describe("#pause(), #unpause()", () => {
    context("when caller is not the owner", () => {
      it("should revert", async () => {
        await expect(alpacaOraclePriceFeedAsAlice.pause()).to.be.revertedWith("!ownerRole")
        await expect(alpacaOraclePriceFeedAsAlice.unpause()).to.be.revertedWith("!ownerRole")
      })
    })
    context("when caller is the owner", () => {
      it("should be able to call pause and unpause perfectly", async () => {
        await alpacaOraclePriceFeed.grantRole(await alpacaOraclePriceFeed.OWNER_ROLE(), aliceAddress)

        expect(await alpacaOraclePriceFeedAsAlice.paused()).to.be.false
        await alpacaOraclePriceFeedAsAlice.pause()
        expect(await alpacaOraclePriceFeedAsAlice.paused()).to.be.true
        await alpacaOraclePriceFeedAsAlice.unpause()
        expect(await alpacaOraclePriceFeedAsAlice.paused()).to.be.false
      })
    })
  })
})
