import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber } from "ethers"
import chai from "chai"
import { solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { StableSwapModule, StableSwapModule__factory } from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"
import { WeiPerRay, WeiPerWad } from "../../helper/unit"

chai.use(solidity)
const { expect } = chai
const { formatBytes32String } = ethers.utils

type fixture = {
  stableSwapModule: StableSwapModule
  mockAuthTokenAdapter: MockContract
  mockBookKeeper: MockContract
  mockStablecoinAdapter: MockContract
  mockAlpacaStablecoin: MockContract
  mockSystemDebtEngine: MockContract
  mockedAccessControlConfig: MockContract
  mockedCollateralPoolConfig: MockContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  const mockedAccessControlConfig = await smockit(await ethers.getContractFactory("AccessControlConfig", deployer))

  const mockedCollateralPoolConfig = await smockit(await ethers.getContractFactory("CollateralPoolConfig", deployer))

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

  // Deploy StableSwapModule
  const StableSwapModule = (await ethers.getContractFactory("StableSwapModule", deployer)) as StableSwapModule__factory
  const stableSwapModule = (await upgrades.deployProxy(StableSwapModule, [
    mockAuthTokenAdapter.address,
    mockStablecoinAdapter.address,
    mockSystemDebtEngine.address,
  ])) as StableSwapModule

  return {
    stableSwapModule,
    mockAuthTokenAdapter,
    mockBookKeeper,
    mockStablecoinAdapter,
    mockAlpacaStablecoin,
    mockSystemDebtEngine,
    mockedAccessControlConfig,
    mockedCollateralPoolConfig,
  }
}

describe("StableSwapModule", () => {
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
  let mockedAccessControlConfig: MockContract
  let mockedCollateralPoolConfig: MockContract

  let stableSwapModule: StableSwapModule
  let stableSwapModuleAsAlice: StableSwapModule

  beforeEach(async () => {
    ;({
      stableSwapModule,
      mockAuthTokenAdapter,
      mockBookKeeper,
      mockStablecoinAdapter,
      mockAlpacaStablecoin,
      mockSystemDebtEngine,
      mockedAccessControlConfig,
      mockedCollateralPoolConfig,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    stableSwapModuleAsAlice = StableSwapModule__factory.connect(stableSwapModule.address, alice) as StableSwapModule
  })

  describe("#swapTokenToStablecoin", () => {
    context("when parameters are valid", () => {
      it("should be able to call swapTokenToStablecoin", async () => {
        mockBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        await stableSwapModule.setFeeIn(WeiPerWad.div(10))
        await expect(stableSwapModuleAsAlice.swapTokenToStablecoin(aliceAddress, WeiPerWad.mul(10)))
          .to.be.emit(stableSwapModule, "LogSwapTokenToStablecoin")
          .withArgs(aliceAddress, WeiPerWad.mul(10), WeiPerWad)

        const { calls: authTokenAdapterDepositCalls } = mockAuthTokenAdapter.smocked.deposit
        expect(authTokenAdapterDepositCalls.length).to.be.equal(1)
        expect(authTokenAdapterDepositCalls[0]._urn).to.be.equal(stableSwapModule.address)
        expect(authTokenAdapterDepositCalls[0]._wad).to.be.equal(WeiPerWad.mul(10))
        expect(authTokenAdapterDepositCalls[0]._msgSender).to.be.equal(aliceAddress)

        const { calls: bookKeeperAdjustPositionCalls } = mockBookKeeper.smocked.adjustPosition
        expect(bookKeeperAdjustPositionCalls.length).to.be.equal(1)
        expect(bookKeeperAdjustPositionCalls[0]._collateralPoolId).to.be.equal(formatBytes32String("BUSD"))
        expect(bookKeeperAdjustPositionCalls[0]._positionAddress).to.be.equal(stableSwapModule.address)
        expect(bookKeeperAdjustPositionCalls[0]._collateralOwner).to.be.equal(stableSwapModule.address)
        expect(bookKeeperAdjustPositionCalls[0]._stablecoinOwner).to.be.equal(stableSwapModule.address)
        expect(bookKeeperAdjustPositionCalls[0]._collateralValue).to.be.equal(WeiPerWad.mul(10))
        expect(bookKeeperAdjustPositionCalls[0]._debtShare).to.be.equal(WeiPerWad.mul(10))

        const { calls: bookKeeperMoveStablecoinCalls } = mockBookKeeper.smocked.moveStablecoin
        expect(bookKeeperMoveStablecoinCalls.length).to.be.equal(1)
        expect(bookKeeperMoveStablecoinCalls[0]._src).to.be.equal(stableSwapModule.address)
        expect(bookKeeperMoveStablecoinCalls[0]._dst).to.be.equal(mockSystemDebtEngine.address)
        expect(bookKeeperMoveStablecoinCalls[0]._value).to.be.equal(WeiPerWad.mul(WeiPerRay))

        const { calls: stablecoinAdapterWithdrawCalls } = mockStablecoinAdapter.smocked.withdraw
        expect(stablecoinAdapterWithdrawCalls.length).to.be.equal(1)
        expect(stablecoinAdapterWithdrawCalls[0].usr).to.be.equal(aliceAddress)
        expect(stablecoinAdapterWithdrawCalls[0].wad).to.be.equal(WeiPerWad.mul(9))
      })
    })
  })
  describe("#swapStablecoinToToken", () => {
    context("when failed transfer", () => {
      it("should be revert", async () => {
        await expect(stableSwapModuleAsAlice.swapStablecoinToToken(aliceAddress, WeiPerWad.mul(10))).to.be.revertedWith(
          "StableSwapModule/failed-transfer"
        )
      })
    })
    context("when parameters are valid", () => {
      it("should be able to call swapStablecoinToToken", async () => {
        await stableSwapModule.setFeeOut(WeiPerWad.div(10))

        mockAlpacaStablecoin.smocked.transferFrom.will.return.with(true)

        await expect(stableSwapModuleAsAlice.swapStablecoinToToken(aliceAddress, WeiPerWad.mul(10)))
          .to.be.emit(stableSwapModule, "LogSwapStablecoinToToken")
          .withArgs(aliceAddress, WeiPerWad.mul(10), WeiPerWad)

        const { calls: stablecoinAdapterDepositCalls } = mockStablecoinAdapter.smocked.deposit
        expect(stablecoinAdapterDepositCalls.length).to.be.equal(1)
        expect(stablecoinAdapterDepositCalls[0].usr).to.be.equal(stableSwapModule.address)
        expect(stablecoinAdapterDepositCalls[0].wad).to.be.equal(WeiPerWad.mul(11))

        const { calls: bookKeeperAdjustPositionCalls } = mockBookKeeper.smocked.adjustPosition
        expect(bookKeeperAdjustPositionCalls.length).to.be.equal(1)
        expect(bookKeeperAdjustPositionCalls[0]._collateralPoolId).to.be.equal(formatBytes32String("BUSD"))
        expect(bookKeeperAdjustPositionCalls[0]._positionAddress).to.be.equal(stableSwapModule.address)
        expect(bookKeeperAdjustPositionCalls[0]._collateralOwner).to.be.equal(stableSwapModule.address)
        expect(bookKeeperAdjustPositionCalls[0]._stablecoinOwner).to.be.equal(stableSwapModule.address)
        expect(bookKeeperAdjustPositionCalls[0]._collateralValue).to.be.equal(WeiPerWad.mul(-10))
        expect(bookKeeperAdjustPositionCalls[0]._debtShare).to.be.equal(WeiPerWad.mul(-10))

        const { calls: authTokenAdapterWithdrawCalls } = mockAuthTokenAdapter.smocked.withdraw
        expect(authTokenAdapterWithdrawCalls.length).to.be.equal(1)
        expect(authTokenAdapterWithdrawCalls[0]._guy).to.be.equal(aliceAddress)
        expect(authTokenAdapterWithdrawCalls[0]._wad).to.be.equal(WeiPerWad.mul(10))

        const { calls: bookKeeperMoveStablecoinCalls } = mockBookKeeper.smocked.moveStablecoin
        expect(bookKeeperMoveStablecoinCalls.length).to.be.equal(1)
        expect(bookKeeperMoveStablecoinCalls[0]._src).to.be.equal(stableSwapModule.address)
        expect(bookKeeperMoveStablecoinCalls[0]._dst).to.be.equal(mockSystemDebtEngine.address)
        expect(bookKeeperMoveStablecoinCalls[0]._value).to.be.equal(WeiPerWad.mul(WeiPerRay))
      })
    })
  })
})
