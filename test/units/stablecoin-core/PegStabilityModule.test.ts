import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber } from "ethers"
import chai from "chai"
import { solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { smockit, MockContract } from "@eth-optimism/smock"
import { WeiPerRay, WeiPerWad } from "../../helper/unit"
import { PegStabilityModule } from "../../../typechain/PegStabilityModule"
import { PegStabilityModule__factory } from "../../../typechain/factories/PegStabilityModule__factory"

chai.use(solidity)
const { expect } = chai
const { formatBytes32String } = ethers.utils

type fixture = {
  pegStabilityModule: PegStabilityModule
  mockAuthTokenAdapter: MockContract
  mockBookKeeper: MockContract
  mockStablecoinAdapter: MockContract
  mockAlpacaStablecoin: MockContract
  mockSystemDebtEngine: MockContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const mockBookKeeper = await smockit(await ethers.getContractFactory("BookKeeper", deployer))
  // Deploy mocked AuthTokenAdapter
  const mockAuthTokenAdapter = await smockit(await ethers.getContractFactory("AuthTokenAdapter", deployer))
  mockAuthTokenAdapter.smocked.bookKeeper.will.return.with(mockBookKeeper.address)
  mockAuthTokenAdapter.smocked.collateralPoolId.will.return.with(formatBytes32String("BUSD"))
  mockAuthTokenAdapter.smocked.decimals.will.return.with(BigNumber.from(18))
  // Deploy mocked AlpacaStablecoin
  const mockAlpacaStablecoin = await smockit(await ethers.getContractFactory("AlpacaStablecoin", deployer))
  // Deploy mocked Stablecoin
  const mockStablecoinAdapter = await smockit(await ethers.getContractFactory("StablecoinAdapter", deployer))
  mockStablecoinAdapter.smocked.stablecoin.will.return.with(mockAlpacaStablecoin.address)
  // Deploy mocked SystemDebtEngine
  const mockSystemDebtEngine = await smockit(await ethers.getContractFactory("SystemDebtEngine", deployer))

  // Deploy PegStabilityModule
  const PegStabilityModule = (await ethers.getContractFactory(
    "PegStabilityModule",
    deployer
  )) as PegStabilityModule__factory
  const pegStabilityModule = (await upgrades.deployProxy(PegStabilityModule, [
    mockAuthTokenAdapter.address,
    mockStablecoinAdapter.address,
    mockSystemDebtEngine.address,
  ])) as PegStabilityModule

  return {
    pegStabilityModule,
    mockAuthTokenAdapter,
    mockBookKeeper,
    mockStablecoinAdapter,
    mockAlpacaStablecoin,
    mockSystemDebtEngine,
  }
}

describe("PegStabilityModule", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string

  // Contracts
  let mockAuthTokenAdapter: MockContract
  let mockBookKeeper: MockContract
  let mockStablecoinAdapter: MockContract
  let mockAlpacaStablecoin: MockContract
  let mockSystemDebtEngine: MockContract

  let pegStabilityModule: PegStabilityModule
  let pegStabilityModuleAsAlice: PegStabilityModule

  beforeEach(async () => {
    ;({
      pegStabilityModule,
      mockAuthTokenAdapter,
      mockBookKeeper,
      mockStablecoinAdapter,
      mockAlpacaStablecoin,
      mockSystemDebtEngine,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    pegStabilityModuleAsAlice = PegStabilityModule__factory.connect(
      pegStabilityModule.address,
      alice
    ) as PegStabilityModule
  })

  describe("#sellToken", () => {
    context("when parameters are valid", () => {
      it("should be able to call sellToken", async () => {
        await pegStabilityModule.file(formatBytes32String("feeIn"), WeiPerWad.div(10))
        await expect(pegStabilityModuleAsAlice.sellToken(aliceAddress, WeiPerWad.mul(10)))
          .to.be.emit(pegStabilityModule, "SellToken")
          .withArgs(aliceAddress, WeiPerWad.mul(10), WeiPerWad)

        const { calls: authTokenAdapterDepositCalls } = mockAuthTokenAdapter.smocked.deposit
        expect(authTokenAdapterDepositCalls.length).to.be.equal(1)
        expect(authTokenAdapterDepositCalls[0].urn).to.be.equal(pegStabilityModule.address)
        expect(authTokenAdapterDepositCalls[0].wad).to.be.equal(WeiPerWad.mul(10))
        expect(authTokenAdapterDepositCalls[0].msgSender).to.be.equal(aliceAddress)

        const { calls: bookKeeperAdjustPositionCalls } = mockBookKeeper.smocked.adjustPosition
        expect(bookKeeperAdjustPositionCalls.length).to.be.equal(1)
        expect(bookKeeperAdjustPositionCalls[0].collateralPoolId).to.be.equal(formatBytes32String("BUSD"))
        expect(bookKeeperAdjustPositionCalls[0].positionAddress).to.be.equal(pegStabilityModule.address)
        expect(bookKeeperAdjustPositionCalls[0].collateralOwner).to.be.equal(pegStabilityModule.address)
        expect(bookKeeperAdjustPositionCalls[0].stablecoinOwner).to.be.equal(pegStabilityModule.address)
        expect(bookKeeperAdjustPositionCalls[0].collateralValue).to.be.equal(WeiPerWad.mul(10))
        expect(bookKeeperAdjustPositionCalls[0].debtShare).to.be.equal(WeiPerWad.mul(10))

        const { calls: bookKeeperMoveStablecoinCalls } = mockBookKeeper.smocked.moveStablecoin
        expect(bookKeeperMoveStablecoinCalls.length).to.be.equal(1)
        expect(bookKeeperMoveStablecoinCalls[0].src).to.be.equal(pegStabilityModule.address)
        expect(bookKeeperMoveStablecoinCalls[0].dst).to.be.equal(mockSystemDebtEngine.address)
        expect(bookKeeperMoveStablecoinCalls[0].value).to.be.equal(WeiPerWad.mul(WeiPerRay))

        const { calls: stablecoinAdapterWithdrawCalls } = mockStablecoinAdapter.smocked.withdraw
        expect(stablecoinAdapterWithdrawCalls.length).to.be.equal(1)
        expect(stablecoinAdapterWithdrawCalls[0].usr).to.be.equal(aliceAddress)
        expect(stablecoinAdapterWithdrawCalls[0].wad).to.be.equal(WeiPerWad.mul(9))
      })
    })
  })
  describe("#buyToken", () => {
    context("when failed transfer", () => {
      it("should be revert", async () => {
        await expect(pegStabilityModuleAsAlice.buyToken(aliceAddress, WeiPerWad.mul(10))).to.be.revertedWith(
          "PegStabilityModule/failed-transfer"
        )
      })
    })
    context("when parameters are valid", () => {
      it("should be able to call buyToken", async () => {
        await pegStabilityModule.file(formatBytes32String("feeOut"), WeiPerWad.div(10))

        mockAlpacaStablecoin.smocked.transferFrom.will.return.with(true)

        await expect(pegStabilityModuleAsAlice.buyToken(aliceAddress, WeiPerWad.mul(10)))
          .to.be.emit(pegStabilityModule, "BuyToken")
          .withArgs(aliceAddress, WeiPerWad.mul(10), WeiPerWad)

        const { calls: stablecoinAdapterDepositCalls } = mockStablecoinAdapter.smocked.deposit
        expect(stablecoinAdapterDepositCalls.length).to.be.equal(1)
        expect(stablecoinAdapterDepositCalls[0].usr).to.be.equal(pegStabilityModule.address)
        expect(stablecoinAdapterDepositCalls[0].wad).to.be.equal(WeiPerWad.mul(11))

        const { calls: bookKeeperAdjustPositionCalls } = mockBookKeeper.smocked.adjustPosition
        expect(bookKeeperAdjustPositionCalls.length).to.be.equal(1)
        expect(bookKeeperAdjustPositionCalls[0].collateralPoolId).to.be.equal(formatBytes32String("BUSD"))
        expect(bookKeeperAdjustPositionCalls[0].positionAddress).to.be.equal(pegStabilityModule.address)
        expect(bookKeeperAdjustPositionCalls[0].collateralOwner).to.be.equal(pegStabilityModule.address)
        expect(bookKeeperAdjustPositionCalls[0].stablecoinOwner).to.be.equal(pegStabilityModule.address)
        expect(bookKeeperAdjustPositionCalls[0].collateralValue).to.be.equal(WeiPerWad.mul(-10))
        expect(bookKeeperAdjustPositionCalls[0].debtShare).to.be.equal(WeiPerWad.mul(-10))

        const { calls: authTokenAdapterWithdrawCalls } = mockAuthTokenAdapter.smocked.withdraw
        expect(authTokenAdapterWithdrawCalls.length).to.be.equal(1)
        expect(authTokenAdapterWithdrawCalls[0].guy).to.be.equal(aliceAddress)
        expect(authTokenAdapterWithdrawCalls[0].wad).to.be.equal(WeiPerWad.mul(10))

        const { calls: bookKeeperMoveStablecoinCalls } = mockBookKeeper.smocked.moveStablecoin
        expect(bookKeeperMoveStablecoinCalls.length).to.be.equal(1)
        expect(bookKeeperMoveStablecoinCalls[0].src).to.be.equal(pegStabilityModule.address)
        expect(bookKeeperMoveStablecoinCalls[0].dst).to.be.equal(mockSystemDebtEngine.address)
        expect(bookKeeperMoveStablecoinCalls[0].value).to.be.equal(WeiPerWad.mul(WeiPerRay))
      })
    })
  })
})
