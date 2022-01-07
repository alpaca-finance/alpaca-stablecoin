import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import {
  BookKeeper__factory,
  BookKeeper,
  TokenAdapter,
  TokenAdapter__factory,
  AccessControlConfig__factory,
  AccessControlConfig,
  CollateralPoolConfig,
  CollateralPoolConfig__factory,
} from "../../../typechain"
import { MockContract, smockit } from "@eth-optimism/smock"
import { ERC20__factory } from "../../../typechain/factories/ERC20__factory"
import { WeiPerWad } from "../../helper/unit"

type fixture = {
  tokenAdapter: TokenAdapter
  mockedBookKeeper: MockContract
  mockedToken: MockContract
  mockedAccessControlConfig: MockContract
  mockedCollateralPoolConfig: MockContract
}
chai.use(solidity)
const { expect } = chai
const { formatBytes32String } = ethers.utils

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  const mockedAccessControlConfig = await smockit(await ethers.getContractFactory("AccessControlConfig", deployer))

  const mockedCollateralPoolConfig = await smockit(await ethers.getContractFactory("CollateralPoolConfig", deployer))

  const mockedBookKeeper = await smockit(await ethers.getContractFactory("BookKeeper", deployer))

  // Deploy mocked ERC20
  const Token = (await ethers.getContractFactory("ERC20", deployer)) as ERC20__factory
  const token = await Token.deploy("BTCB", "BTCB")
  await token.deployed()
  const mockedToken = await smockit(token)
  mockedToken.smocked.decimals.will.return.with(18)

  // Deploy TokenAdapter
  const TokenAdapter = (await ethers.getContractFactory("TokenAdapter", deployer)) as TokenAdapter__factory
  const tokenAdapter = (await upgrades.deployProxy(TokenAdapter, [
    mockedBookKeeper.address,
    formatBytes32String("BTCB"),
    mockedToken.address,
  ])) as TokenAdapter
  await tokenAdapter.deployed()

  return { tokenAdapter, mockedBookKeeper, mockedToken, mockedAccessControlConfig, mockedCollateralPoolConfig }
}

describe("TokenAdapter", () => {
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

  //Contract
  let tokenAdapter: TokenAdapter
  let mockedBookKeeper: MockContract
  let mockedToken: MockContract
  let mockedAccessControlConfig: MockContract
  let mockedCollateralPoolConfig: MockContract
  let tokenAdapterAsAlice: TokenAdapter

  beforeEach(async () => {
    ;({ tokenAdapter, mockedBookKeeper, mockedToken, mockedAccessControlConfig, mockedCollateralPoolConfig } =
      await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])

    tokenAdapterAsAlice = TokenAdapter__factory.connect(tokenAdapter.address, alice) as TokenAdapter
  })

  describe("#deposit()", () => {
    context("when the token adapter is inactive", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        await tokenAdapter.cage()
        await expect(tokenAdapter.deposit(aliceAddress, WeiPerWad.mul(1), "0x")).to.be.revertedWith(
          "TokenAdapter/not-live"
        )
      })
    })

    context("when wad input is overflow (> MaxInt256)", () => {
      it("should revert", async () => {
        await expect(tokenAdapter.deposit(aliceAddress, ethers.constants.MaxUint256, "0x")).to.be.revertedWith(
          "TokenAdapter/overflow"
        )
      })
    })

    context("when transfer fail", () => {
      it("should revert", async () => {
        await expect(tokenAdapter.deposit(aliceAddress, WeiPerWad.mul(1), "0x")).to.be.revertedWith("!safeTransferFrom")
      })
    })

    context("when parameters are valid", () => {
      it("should be able to call bookkeeper.addCollateral() correctly", async () => {
        mockedBookKeeper.smocked.addCollateral.will.return.with()
        mockedToken.smocked.transferFrom.will.return.with(true)
        await tokenAdapter.deposit(aliceAddress, WeiPerWad.mul(1), "0x")

        const { calls: addCollateral } = mockedBookKeeper.smocked.addCollateral
        const { calls: transferFrom } = mockedToken.smocked.transferFrom
        expect(addCollateral.length).to.be.equal(1)
        expect(addCollateral[0]._collateralPoolId).to.be.equal(formatBytes32String("BTCB"))
        expect(addCollateral[0]._usr).to.be.equal(aliceAddress)
        expect(addCollateral[0]._amount).to.be.equal(BigNumber.from("1000000000000000000"))

        expect(transferFrom.length).to.be.equal(1)
        expect(transferFrom[0].sender).to.be.equal(deployerAddress)
        expect(transferFrom[0].recipient).to.be.equal(tokenAdapter.address)
        expect(transferFrom[0].amount).to.be.equal(BigNumber.from("1000000000000000000"))
      })
    })
  })

  describe("#withdraw()", () => {
    context("when wad input is overflow (> MaxInt256)", () => {
      it("should revert", async () => {
        await expect(tokenAdapter.withdraw(aliceAddress, ethers.constants.MaxUint256, "0x")).to.be.revertedWith(
          "TokenAdapter/overflow"
        )
      })
    })

    context("when transfer fail", () => {
      it("should revert", async () => {
        await expect(tokenAdapter.withdraw(aliceAddress, WeiPerWad.mul(1), "0x")).to.be.revertedWith("!safeTransfer")
      })
    })

    context("when parameters are valid", () => {
      it("should be able to call bookkeeper.addCollateral() correctly", async () => {
        mockedBookKeeper.smocked.addCollateral.will.return.with()
        mockedToken.smocked.transfer.will.return.with(true)
        await tokenAdapter.withdraw(aliceAddress, WeiPerWad.mul(1), "0x")

        const { calls: addCollateral } = mockedBookKeeper.smocked.addCollateral
        const { calls: transfer } = mockedToken.smocked.transfer
        expect(addCollateral.length).to.be.equal(1)
        expect(addCollateral[0]._collateralPoolId).to.be.equal(formatBytes32String("BTCB"))
        expect(addCollateral[0]._usr).to.be.equal(deployerAddress)
        expect(addCollateral[0]._amount).to.be.equal(BigNumber.from("-1000000000000000000"))

        expect(transfer.length).to.be.equal(1)
        expect(transfer[0].recipient).to.be.equal(aliceAddress)
        expect(transfer[0].amount).to.be.equal(BigNumber.from("1000000000000000000"))
      })
    })
  })

  describe("#cage()", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(tokenAdapterAsAlice.cage()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })

    context("when role can access", () => {
      context("caller is owner role ", () => {
        it("should be set live to 0", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          expect(await tokenAdapterAsAlice.live()).to.be.equal(1)

          await expect(tokenAdapterAsAlice.cage()).to.emit(tokenAdapterAsAlice, "LogCage").withArgs()

          expect(await tokenAdapterAsAlice.live()).to.be.equal(0)
        })
      })

      context("caller is showStopper role", () => {
        it("should be set live to 0", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          expect(await tokenAdapterAsAlice.live()).to.be.equal(1)

          await expect(tokenAdapterAsAlice.cage()).to.emit(tokenAdapterAsAlice, "LogCage").withArgs()

          expect(await tokenAdapterAsAlice.live()).to.be.equal(0)
        })
      })
    })
  })

  describe("#uncage()", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(tokenAdapterAsAlice.uncage()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })

    context("when role can access", () => {
      context("caller is owner role ", () => {
        it("should be set live to 1", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          expect(await tokenAdapterAsAlice.live()).to.be.equal(1)

          await tokenAdapterAsAlice.cage()

          expect(await tokenAdapterAsAlice.live()).to.be.equal(0)

          await expect(tokenAdapterAsAlice.uncage()).to.emit(tokenAdapterAsAlice, "LogUncage").withArgs()

          expect(await tokenAdapterAsAlice.live()).to.be.equal(1)
        })
      })

      context("caller is showStopper role", () => {
        it("should be set live to 1", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          expect(await tokenAdapterAsAlice.live()).to.be.equal(1)

          await tokenAdapterAsAlice.cage()

          expect(await tokenAdapterAsAlice.live()).to.be.equal(0)

          await expect(tokenAdapterAsAlice.uncage()).to.emit(tokenAdapterAsAlice, "LogUncage").withArgs()

          expect(await tokenAdapterAsAlice.live()).to.be.equal(1)
        })
      })
    })
  })
})
