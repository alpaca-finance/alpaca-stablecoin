import { ethers, upgrades, waffle } from "hardhat"
import { Signer } from "ethers"
import chai from "chai"
import { solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { IbTokenPriceFeed, IbTokenPriceFeed__factory, MockPriceFeed__factory, MockPriceFeed } from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"
import { formatBytes32BigNumber } from "../../helper/format"
import { parseEther } from "ethers/lib/utils"
import { AccessControlConfig } from "../../../typechain/AccessControlConfig"
import { AccessControlConfig__factory } from "../../../typechain/factories/AccessControlConfig__factory"

chai.use(solidity)
const { expect } = chai
type fixture = {
  ibTokenPriceFeed: IbTokenPriceFeed
  mockedIbBasePriceFeed: MockContract
  mockedBaseUsdPriceFeed: MockContract
  mockedAccessControlConfig: MockContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked AlpacaOracle
  const MockPriceFeed = (await ethers.getContractFactory("MockPriceFeed", deployer)) as MockPriceFeed__factory

  const mockPriceFeedA = (await upgrades.deployProxy(MockPriceFeed, [])) as MockPriceFeed
  await mockPriceFeedA.deployed()
  const mockedIbBasePriceFeed = await smockit(mockPriceFeedA)

  const mockPriceFeedB = (await upgrades.deployProxy(MockPriceFeed, [])) as MockPriceFeed
  await mockPriceFeedB.deployed()
  const mockedBaseUsdPriceFeed = await smockit(mockPriceFeedB)

  const AccessControlConfig = (await ethers.getContractFactory(
    "AccessControlConfig",
    deployer
  )) as AccessControlConfig__factory
  const mockAccessControlConfig = (await upgrades.deployProxy(AccessControlConfig, [])) as AccessControlConfig
  await mockAccessControlConfig.deployed()
  const mockedAccessControlConfig = await smockit(mockAccessControlConfig)

  // Deploy IbTokenPriceFeed
  const IbTokenPriceFeed = (await ethers.getContractFactory("IbTokenPriceFeed", deployer)) as IbTokenPriceFeed__factory
  const ibTokenPriceFeed = (await upgrades.deployProxy(IbTokenPriceFeed, [
    mockedIbBasePriceFeed.address,
    mockedBaseUsdPriceFeed.address,
    mockedAccessControlConfig.address,
  ])) as IbTokenPriceFeed
  await ibTokenPriceFeed.deployed()

  return { ibTokenPriceFeed, mockedIbBasePriceFeed, mockedBaseUsdPriceFeed, mockedAccessControlConfig }
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
  let mockedAccessControlConfig: MockContract
  let ibTokenPriceFeedAsAlice: IbTokenPriceFeed
  let ibTokenPriceFeedAsBob: IbTokenPriceFeed

  beforeEach(async () => {
    ;({ ibTokenPriceFeed, mockedIbBasePriceFeed, mockedBaseUsdPriceFeed, mockedAccessControlConfig } =
      await waffle.loadFixture(loadFixtureHandler))
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
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)
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
