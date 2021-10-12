import { ethers, upgrades, waffle } from "hardhat"
import { BigNumber, Signer, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { IbTokenPriceFeed, IbTokenPriceFeed__factory, MockPriceFeed__factory, MockPriceFeed } from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"
import { AddressOne, AddressTwo } from "../../helper/address"
import { WeiPerWad } from "../../helper/unit"
import { DateTime } from "luxon"
import { formatBytes32BigNumber } from "../../helper/format"
import { formatEther, parseEther } from "ethers/lib/utils"

chai.use(solidity)
const { expect } = chai
type fixture = {
  ibTokenPriceFeed: IbTokenPriceFeed
  mockedPriceFeedA: MockContract
  mockedPriceFeedB: MockContract
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
  const MockPriceFeed = (await ethers.getContractFactory("MockPriceFeed", deployer)) as MockPriceFeed__factory

  const mockPriceFeedA = (await upgrades.deployProxy(MockPriceFeed, [])) as MockPriceFeed
  await mockPriceFeedA.deployed()
  const mockedPriceFeedA = await smockit(mockPriceFeedA)

  const mockPriceFeedB = (await upgrades.deployProxy(MockPriceFeed, [])) as MockPriceFeed
  await mockPriceFeedB.deployed()
  const mockedPriceFeedB = await smockit(mockPriceFeedB)

  // Deploy IbTokenPriceFeed
  const IbTokenPriceFeed = (await ethers.getContractFactory("IbTokenPriceFeed", deployer)) as IbTokenPriceFeed__factory
  const ibTokenPriceFeed = (await upgrades.deployProxy(IbTokenPriceFeed, [
    mockedPriceFeedA.address,
    mockedPriceFeedB.address,
  ])) as IbTokenPriceFeed
  await ibTokenPriceFeed.deployed()

  return { ibTokenPriceFeed, mockedPriceFeedA, mockedPriceFeedB }
}

describe("IbTokenPriceFeed", () => {
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
  let ibTokenPriceFeed: IbTokenPriceFeed
  let mockedIbBasePriceFeed: MockContract
  let mockedBaseUsdPriceFeed: MockContract
  let ibTokenPriceFeedAsAlice: IbTokenPriceFeed
  let ibTokenPriceFeedAsBob: IbTokenPriceFeed

  beforeEach(async () => {
    ;({
      ibTokenPriceFeed,
      mockedPriceFeedA: mockedIbBasePriceFeed,
      mockedPriceFeedB: mockedBaseUsdPriceFeed,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])

    ibTokenPriceFeedAsAlice = IbTokenPriceFeed__factory.connect(ibTokenPriceFeed.address, alice) as IbTokenPriceFeed
    ibTokenPriceFeedAsBob = IbTokenPriceFeed__factory.connect(ibTokenPriceFeed.address, bob) as IbTokenPriceFeed
  })

  describe("#peekPrice()", () => {
    const assertPeekPriceCall = (calls: any[]) => {
      expect(calls.length).to.be.equal(1)
    }

    context("when ibInBasePriceFeed returns ok=false", () => {
      it("should be able to get price with okFlag = false", async () => {
        // 1 ibBNB = 1.1 BNB
        mockedIbBasePriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(parseEther("1.1")), false])
        // 1 BNB = 400 USD
        mockedBaseUsdPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(parseEther("400")), true])

        const [price, ok] = await ibTokenPriceFeed.peekPrice()
        expect(price).to.be.equal(parseEther("440"))
        expect(ok).to.be.false

        assertPeekPriceCall(mockedIbBasePriceFeed.smocked.peekPrice.calls)
        assertPeekPriceCall(mockedBaseUsdPriceFeed.smocked.peekPrice.calls)
      })
    })
    context("when baseInUsdPriceFeed returns ok=false", () => {
      it("should be able to get price with okFlag = false", async () => {
        // 1 ibBNB = 1.1 BNB
        mockedIbBasePriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(parseEther("1.1")), true])
        // 1 BNB = 400 USD
        mockedBaseUsdPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(parseEther("400")), false])

        const [price, ok] = await ibTokenPriceFeed.peekPrice()
        expect(price).to.be.equal(parseEther("440"))
        expect(ok).to.be.false

        assertPeekPriceCall(mockedIbBasePriceFeed.smocked.peekPrice.calls)
        assertPeekPriceCall(mockedBaseUsdPriceFeed.smocked.peekPrice.calls)
      })
    })
    context("when both returns ok=true", () => {
      it("should be able to get price with okFlag = true", async () => {
        // 1 ibBNB = 1.1 BNB
        mockedIbBasePriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(parseEther("1.1")), true])
        // 1 BNB = 400 USD
        mockedBaseUsdPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(parseEther("400")), true])

        const [price, ok] = await ibTokenPriceFeed.peekPrice()
        expect(price).to.be.equal(parseEther("440"))
        expect(ok).to.be.true

        assertPeekPriceCall(mockedIbBasePriceFeed.smocked.peekPrice.calls)
        assertPeekPriceCall(mockedBaseUsdPriceFeed.smocked.peekPrice.calls)
      })
    })
    context("when contract is in paused state", () => {
      it("should be able to get price with okFlag = false", async () => {
        await ibTokenPriceFeed.pause()
        // 1 ibBNB = 1.1 BNB
        mockedIbBasePriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(parseEther("1.1")), true])
        // 1 BNB = 400 USD
        mockedBaseUsdPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(parseEther("400")), true])

        const [price, ok] = await ibTokenPriceFeed.peekPrice()
        expect(price).to.be.equal(parseEther("440"))
        expect(ok).to.be.false

        assertPeekPriceCall(mockedIbBasePriceFeed.smocked.peekPrice.calls)
        assertPeekPriceCall(mockedBaseUsdPriceFeed.smocked.peekPrice.calls)
      })
    })
  })
})
