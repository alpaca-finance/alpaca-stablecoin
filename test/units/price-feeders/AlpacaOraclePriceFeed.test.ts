import { ethers, upgrades, waffle } from "hardhat"
import { BigNumber, Signer, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import {
  AlpacaOraclePriceFeed,
  AlpacaOraclePriceFeed__factory,
  MockAlpacaOracle,
  MockAlpacaOracle__factory,
  AccessControlConfig,
  AccessControlConfig__factory,
} from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"
import { AddressOne, AddressTwo } from "../../helper/address"
import { WeiPerWad } from "../../helper/unit"
import { DateTime } from "luxon"
import { duration, increase, latest } from "../../helper/time"

chai.use(solidity)
const { expect } = chai
type fixture = {
  alpacaOraclePriceFeed: AlpacaOraclePriceFeed
  mockedAlpacaOracle: MockContract
  mockedAccessControlConfig: MockContract
}

const token0Address = AddressOne
const token1Address = AddressTwo

const nHoursAgoInSec = (now: BigNumber, n: number): BigNumber => {
  return now.sub(n * 60 * 60)
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const MockAlpacaOracle = (await ethers.getContractFactory("MockAlpacaOracle", deployer)) as MockAlpacaOracle__factory
  const mockAlpacaOracle = (await upgrades.deployProxy(MockAlpacaOracle, [])) as MockAlpacaOracle
  await mockAlpacaOracle.deployed()
  const mockedAlpacaOracle = await smockit(mockAlpacaOracle)

  const AccessControlConfig = (await ethers.getContractFactory(
    "AccessControlConfig",
    deployer
  )) as AccessControlConfig__factory
  const mockAccessControlConfig = (await upgrades.deployProxy(AccessControlConfig, [])) as AccessControlConfig
  await mockAccessControlConfig.deployed()
  const mockedAccessControlConfig = await smockit(mockAccessControlConfig)

  // Deploy AlpacaOraclePriceFeed
  const AlpacaOraclePriceFeed = (await ethers.getContractFactory(
    "AlpacaOraclePriceFeed",
    deployer
  )) as AlpacaOraclePriceFeed__factory
  const alpacaOraclePriceFeed = (await upgrades.deployProxy(AlpacaOraclePriceFeed, [
    mockedAlpacaOracle.address,
    token0Address,
    token1Address,
    mockedAccessControlConfig.address,
  ])) as AlpacaOraclePriceFeed
  await alpacaOraclePriceFeed.deployed()

  return { alpacaOraclePriceFeed, mockedAlpacaOracle, mockedAccessControlConfig }
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
  let mockedAccessControlConfig: MockContract
  let alpacaOraclePriceFeedAsAlice: AlpacaOraclePriceFeed
  let alpacaOraclePriceFeedAsBob: AlpacaOraclePriceFeed

  beforeEach(async () => {
    ;({ alpacaOraclePriceFeed, mockedAlpacaOracle, mockedAccessControlConfig } = await waffle.loadFixture(
      loadFixtureHandler
    ))
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
          const now = await latest()

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
          const now = await latest()

          mockedAlpacaOracle.smocked.getPrice.will.return.with([WeiPerWad.mul(10), nHoursAgoInSec(now, 23)])
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

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
          const now = await latest()

          mockedAlpacaOracle.smocked.getPrice.will.return.with([WeiPerWad.mul(10), nHoursAgoInSec(now, 3)])
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

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
          const now = await latest()
          mockedAlpacaOracle.smocked.getPrice.will.return.with([WeiPerWad.mul(10), nHoursAgoInSec(now, 1)])
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

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
        const now = await latest()
        mockedAlpacaOracle.smocked.getPrice.will.return.with([WeiPerWad.mul(10), nHoursAgoInSec(now, 0)])
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

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
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(alpacaOraclePriceFeedAsAlice.pause()).to.be.revertedWith("!(ownerRole or govRole)")
        await expect(alpacaOraclePriceFeedAsAlice.unpause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })
    context("when caller is the owner", () => {
      it("should be able to call pause and unpause perfectly", async () => {
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        expect(await alpacaOraclePriceFeedAsAlice.paused()).to.be.false
        await alpacaOraclePriceFeedAsAlice.pause()
        expect(await alpacaOraclePriceFeedAsAlice.paused()).to.be.true
        await alpacaOraclePriceFeedAsAlice.unpause()
        expect(await alpacaOraclePriceFeedAsAlice.paused()).to.be.false
      })
    })
  })
})
