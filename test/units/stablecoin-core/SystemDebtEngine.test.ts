import { ethers, upgrades, waffle } from "hardhat"
import { BigNumber, Signer } from "ethers"
import chai from "chai"
import { solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { SystemDebtEngine, SystemDebtEngine__factory } from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"

import * as UnitHelpers from "../../helper/unit"

chai.use(solidity)
const { expect } = chai

type fixture = {
  systemDebtEngine: SystemDebtEngine
  mockedBookKeeper: MockContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const mockedBookKeeper = await smockit(await ethers.getContractFactory("BookKeeper", deployer))

  const SystemDebtEngine = (await ethers.getContractFactory("SystemDebtEngine", deployer)) as SystemDebtEngine__factory
  const systemDebtEngine = (await upgrades.deployProxy(SystemDebtEngine, [
    mockedBookKeeper.address,
    mockedBookKeeper.address,
    mockedBookKeeper.address,
  ])) as SystemDebtEngine
  return { systemDebtEngine, mockedBookKeeper }
}

describe("SystemDebtEngine", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string

  // Contracts
  let mockedBookKeeper: MockContract

  let systemDebtEngine: SystemDebtEngine
  let systemDebtEngineAsAlice: SystemDebtEngine

  beforeEach(async () => {
    ;({ systemDebtEngine, mockedBookKeeper } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    systemDebtEngineAsAlice = SystemDebtEngine__factory.connect(systemDebtEngine.address, alice) as SystemDebtEngine
  })

  describe("#settleSystemBadDebt", () => {
    context("when insufficient surplus", () => {
      it("should be revert", async () => {
        await expect(systemDebtEngine.settleSystemBadDebt(UnitHelpers.WeiPerRad)).to.be.revertedWith(
          "SystemDebtEngine/insufficient-surplus"
        )
      })
    })
    context("when insufficient debt", () => {
      it("should be revert", async () => {
        mockedBookKeeper.smocked.stablecoin.will.return.with(UnitHelpers.WeiPerRad)

        await expect(systemDebtEngine.settleSystemBadDebt(UnitHelpers.WeiPerRad)).to.be.revertedWith(
          "SystemDebtEngine/insufficient-debt"
        )
      })
    })
    context("when parameters are valid", () => {
      it("should be able to call settleSystemBadDebt", async () => {
        mockedBookKeeper.smocked.stablecoin.will.return.with(UnitHelpers.WeiPerRad)
        mockedBookKeeper.smocked.systemBadDebt.will.return.with(UnitHelpers.WeiPerRad)

        await systemDebtEngine.settleSystemBadDebt(UnitHelpers.WeiPerRad)

        const { calls } = mockedBookKeeper.smocked.settleSystemBadDebt
        expect(calls.length).to.be.equal(1)
        expect(calls[0].rad).to.be.equal(UnitHelpers.WeiPerRad)
      })
    })
  })

  describe("#cage", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        it("shoud be revert", async () => {
          await expect(systemDebtEngine.cage()).to.be.revertedWith("SystemDebtEngine/not-authorized")
        })
      })
    })
    context("when parameters are valid", () => {
      it("should be able to call cage", async () => {
        const liveBefore = await systemDebtEngine.live()
        expect(liveBefore).to.be.equal(1)

        await systemDebtEngine.cage()

        const liveAfter = await systemDebtEngine.live()
        expect(liveAfter).to.be.equal(0)
      })
    })
    context("when SystemDebtEngine doesn't live", () => {
      it("shoud be revert", async () => {
        await systemDebtEngine.cage()

        await expect(systemDebtEngine.cage()).to.be.revertedWith("SystemDebtEngine/not-live")
      })
    })
  })

  describe("#setSurplusBuffer", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(systemDebtEngineAsAlice.setSurplusBuffer(UnitHelpers.WeiPerRad)).to.be.revertedWith(
          "SystemDebtEngine/not-authorized"
        )
      })
    })
    context("when the caller is the owner", async () => {
      it("should be able to call setSurplusBuffer", async () => {
        await expect(systemDebtEngine.setSurplusBuffer(UnitHelpers.WeiPerRad))
          .to.emit(systemDebtEngine, "SetSurplusBuffer")
          .withArgs(deployerAddress, UnitHelpers.WeiPerRad)
      })
    })
  })
})
