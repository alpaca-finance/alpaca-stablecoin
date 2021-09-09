import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { smockit, MockContract } from "@eth-optimism/smock"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"
import { FlashMintModule } from "../../../typechain/FlashMintModule"
import { FlashMintModule__factory } from "../../../typechain/factories/FlashMintModule__factory"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { parseEther, keccak256, toUtf8Bytes, formatBytes32String } = ethers.utils

type fixture = {
  flashMintModule: FlashMintModule
  mockAlpacaStablecoin: MockContract
  mockERC20: MockContract
  mockMyFashLoan: MockContract
  mockBookKeeper: MockContract
  mockStablecoinAdapter: MockContract
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const mockBookKeeper = await smockit(await ethers.getContractFactory("BookKeeper", deployer))

  // Deploy mocked AlpacaStablecoin
  const mockAlpacaStablecoin = await smockit(await ethers.getContractFactory("AlpacaStablecoin", deployer))

  // Deploy mocked ERC20
  const mockERC20 = await smockit(await ethers.getContractFactory("ERC20", deployer))

  // Deploy mocked StablecoinAdapter
  const mockStablecoinAdapter = await smockit(await ethers.getContractFactory("StablecoinAdapter", deployer))
  mockStablecoinAdapter.smocked.bookKeeper.will.return.with(mockBookKeeper.address)
  mockStablecoinAdapter.smocked.stablecoin.will.return.with(mockAlpacaStablecoin.address)

  // Deploy mocked SystemDebtEngine
  const mockSystemDebtEngine = await smockit(await ethers.getContractFactory("SystemDebtEngine", deployer))

  // Deploy mocked FlashLoan
  const mockMyFashLoan = await smockit(await ethers.getContractFactory("MockMyFlashLoan", deployer))

  // Deploy mocked FlashMintModule
  const FlashMintModule = (await ethers.getContractFactory("FlashMintModule", deployer)) as FlashMintModule__factory
  const flashMintModule = (await FlashMintModule.deploy(
    mockStablecoinAdapter.address,
    mockSystemDebtEngine.address
  )) as FlashMintModule

  return { flashMintModule, mockAlpacaStablecoin, mockMyFashLoan, mockERC20, mockBookKeeper, mockStablecoinAdapter }
}

describe("FlashMintModule", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string

  // Contracts
  let mockAlpacaStablecoin: MockContract
  let mockERC20: MockContract
  let mockMyFashLoan: MockContract
  let mockBookKeeper: MockContract
  let mockStablecoinAdapter: MockContract

  let flashMintModule: FlashMintModule
  let flashMintModuleAsAlice: FlashMintModule

  beforeEach(async () => {
    ;({ flashMintModule, mockAlpacaStablecoin, mockMyFashLoan, mockERC20, mockBookKeeper, mockStablecoinAdapter } =
      await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    flashMintModuleAsAlice = FlashMintModule__factory.connect(flashMintModule.address, alice) as FlashMintModule
  })
  describe("#setMax", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(flashMintModuleAsAlice.setMax(WeiPerWad.mul(100))).to.be.revertedWith("!ownerRole")
      })
    })
    context("when the caller is the owner", () => {
      it("should be able setMax", async () => {
        const maxBefore = await flashMintModule.max()
        expect(maxBefore).to.be.equal(0)

        await expect(flashMintModule.setMax(WeiPerWad.mul(100)))
          .to.be.emit(flashMintModule, "SetMax")
          .withArgs(WeiPerWad.mul(100))

        const maxAfter = await flashMintModule.max()
        expect(maxAfter).to.be.equal(WeiPerWad.mul(100))
      })
    })
  })
  describe("#setToll", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(flashMintModuleAsAlice.setToll(WeiPerWad.div(10))).to.be.revertedWith("!ownerRole")
      })
    })
    context("when the caller is the owner", () => {
      it("should be able setToll", async () => {
        const maxBefore = await flashMintModule.toll()
        expect(maxBefore).to.be.equal(0)

        await expect(flashMintModule.setToll(WeiPerWad.div(10)))
          .to.be.emit(flashMintModule, "SetToll")
          .withArgs(WeiPerWad.div(10))

        const maxAfter = await flashMintModule.toll()
        expect(maxAfter).to.be.equal(WeiPerWad.div(10))
      })
    })
  })
  describe("#flashFee", () => {
    context("when token invalid", () => {
      it("should be revert", async () => {
        expect(flashMintModule.flashFee(mockERC20.address, WeiPerWad.mul(10))).to.be.revertedWith(
          "FlashMintModule/token-unsupported"
        )
      })
    })
    context("when token valid", () => {
      it("should be able to call flashFee", async () => {
        flashMintModule.setToll(WeiPerWad.div(10))
        const fee = await flashMintModule.flashFee(mockAlpacaStablecoin.address, WeiPerWad.mul(10))
        expect(fee).to.be.equal(WeiPerWad)
      })
    })
  })
  describe("#flashLoan", () => {
    context("when invalid token", () => {
      it("should be revert", async () => {
        await expect(
          flashMintModule.flashLoan(
            mockMyFashLoan.address,
            mockERC20.address,
            WeiPerWad.mul(10),
            formatBytes32String("")
          )
        ).to.be.revertedWith("FlashMintModule/token-unsupported")
      })
    })
    context("when ceiling exceeded", () => {
      it("should be revert", async () => {
        await expect(
          flashMintModule.flashLoan(
            mockMyFashLoan.address,
            mockAlpacaStablecoin.address,
            WeiPerWad.mul(10),
            formatBytes32String("")
          )
        ).to.be.revertedWith("FlashMintModule/ceiling-exceeded")
      })
    })
    context("when callback failed", () => {
      it("should be revert", async () => {
        await flashMintModule.setMax(WeiPerWad.mul(100))
        await flashMintModule.setToll(WeiPerWad.div(10))
        await expect(
          flashMintModule.flashLoan(
            mockMyFashLoan.address,
            mockAlpacaStablecoin.address,
            WeiPerWad.mul(10),
            formatBytes32String("")
          )
        ).to.be.revertedWith("FlashMintModule/callback-failed")
      })
    })
    context("when parameters are valid", () => {
      it("should be able to call flashLoan", async () => {
        await flashMintModule.setMax(WeiPerWad.mul(100))
        await flashMintModule.setToll(WeiPerWad.div(10))
        mockMyFashLoan.smocked.onFlashLoan.will.return.with(keccak256(toUtf8Bytes("ERC3156FlashBorrower.onFlashLoan")))
        await expect(
          flashMintModule.flashLoan(
            mockMyFashLoan.address,
            mockAlpacaStablecoin.address,
            WeiPerWad.mul(10),
            formatBytes32String("")
          )
        ).to.be.emit(flashMintModule, "FlashLoan")

        const { calls: bookKeeperMinUnbackStablecoinCalls } = mockBookKeeper.smocked.mintUnbackedStablecoin
        expect(bookKeeperMinUnbackStablecoinCalls.length).to.be.equal(1)
        expect(bookKeeperMinUnbackStablecoinCalls[0].from).to.be.equal(flashMintModule.address)
        expect(bookKeeperMinUnbackStablecoinCalls[0].to).to.be.equal(flashMintModule.address)
        expect(bookKeeperMinUnbackStablecoinCalls[0].rad).to.be.equal(WeiPerRad.mul(10))

        const { calls: stablecoinAdapterWithdrawCalls } = mockStablecoinAdapter.smocked.withdraw
        expect(stablecoinAdapterWithdrawCalls.length).to.be.equal(1)
        expect(stablecoinAdapterWithdrawCalls[0].usr).to.be.equal(mockMyFashLoan.address)
        expect(stablecoinAdapterWithdrawCalls[0].wad).to.be.equal(WeiPerWad.mul(10))

        const { calls: stablecoinTranferFromCalls } = mockAlpacaStablecoin.smocked.transferFrom
        expect(stablecoinTranferFromCalls.length).to.be.equal(1)
        expect(stablecoinTranferFromCalls[0].src).to.be.equal(mockMyFashLoan.address)
        expect(stablecoinTranferFromCalls[0].dst).to.be.equal(flashMintModule.address)
        expect(stablecoinTranferFromCalls[0].wad).to.be.equal(WeiPerWad.mul(11))

        const { calls: stablecoinAdapterDepositCalls } = mockStablecoinAdapter.smocked.deposit
        expect(stablecoinAdapterDepositCalls.length).to.be.equal(1)
        expect(stablecoinAdapterDepositCalls[0].usr).to.be.equal(flashMintModule.address)
        expect(stablecoinAdapterDepositCalls[0].wad).to.be.equal(WeiPerWad.mul(11))

        const { calls: bookKeeperSettleSystemBadDebtCalls } = mockBookKeeper.smocked.settleSystemBadDebt
        expect(bookKeeperSettleSystemBadDebtCalls.length).to.be.equal(1)
        expect(bookKeeperSettleSystemBadDebtCalls[0].rad).to.be.equal(WeiPerRad.mul(10))
      })
    })
  })

  describe("#bookKeeperStablecoinFlashLoan", () => {
    context("when ceiling exceeded", () => {
      it("should be revert", async () => {
        await expect(
          flashMintModule.bookKeeperStablecoinFlashLoan(
            mockMyFashLoan.address,
            WeiPerRad.mul(10),
            formatBytes32String("")
          )
        ).to.be.revertedWith("FlashMintModule/ceiling-exceeded")
      })
    })
    context("when callback failed", () => {
      it("should be revert", async () => {
        await flashMintModule.setMax(WeiPerWad.mul(100))
        await flashMintModule.setToll(WeiPerWad.div(10))
        await expect(
          flashMintModule.bookKeeperStablecoinFlashLoan(
            mockMyFashLoan.address,
            WeiPerRad.mul(10),
            formatBytes32String("")
          )
        ).to.be.revertedWith("FlashMintModule/callback-failed")
      })
    })
    context("when insufficient fee", () => {
      it("should be revert", async () => {
        await flashMintModule.setMax(WeiPerWad.mul(100))
        await flashMintModule.setToll(WeiPerWad.div(10))
        mockMyFashLoan.smocked.onBookKeeperStablecoinFlashLoan.will.return.with(
          keccak256(toUtf8Bytes("BookKeeperStablecoinFlashBorrower.onBookKeeperStablecoinFlashLoan"))
        )
        await expect(
          flashMintModule.bookKeeperStablecoinFlashLoan(
            mockMyFashLoan.address,
            WeiPerRad.mul(10),
            formatBytes32String("")
          )
        ).to.be.revertedWith("FlashMintModule/insufficient-fee")
      })
    })
    context("when parameters are valid", () => {
      it("should be able to call flashLoan", async () => {
        await flashMintModule.setMax(WeiPerWad.mul(100))
        mockMyFashLoan.smocked.onBookKeeperStablecoinFlashLoan.will.return.with(
          keccak256(toUtf8Bytes("BookKeeperStablecoinFlashBorrower.onBookKeeperStablecoinFlashLoan"))
        )
        await expect(
          flashMintModule.bookKeeperStablecoinFlashLoan(
            mockMyFashLoan.address,
            WeiPerRad.mul(10),
            formatBytes32String("")
          )
        ).to.be.emit(flashMintModule, "BookKeeperStablecoinFlashLoan")

        const { calls: bookKeeperMinUnbackStablecoinCalls } = mockBookKeeper.smocked.mintUnbackedStablecoin
        expect(bookKeeperMinUnbackStablecoinCalls.length).to.be.equal(1)
        expect(bookKeeperMinUnbackStablecoinCalls[0].from).to.be.equal(flashMintModule.address)
        expect(bookKeeperMinUnbackStablecoinCalls[0].to).to.be.equal(mockMyFashLoan.address)
        expect(bookKeeperMinUnbackStablecoinCalls[0].rad).to.be.equal(WeiPerRad.mul(10))

        const { calls: bookKeeperSettleSystemBadDebtCalls } = mockBookKeeper.smocked.settleSystemBadDebt
        expect(bookKeeperSettleSystemBadDebtCalls.length).to.be.equal(1)
        expect(bookKeeperSettleSystemBadDebtCalls[0].rad).to.be.equal(WeiPerRad.mul(10))
      })
    })
  })
})
