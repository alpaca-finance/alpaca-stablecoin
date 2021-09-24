import { ethers, upgrades, waffle } from "hardhat"
import { BigNumber, Signer } from "ethers"
import chai from "chai"
import { solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { BookKeeper, SystemDebtEngine, SystemDebtEngine__factory } from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"

import * as UnitHelpers from "../../helper/unit"
import { formatBytes32String } from "ethers/lib/utils"

chai.use(solidity)
const { expect } = chai

type fixture = {
  systemDebtEngine: SystemDebtEngine
  mockedBookKeeper: MockContract
  mockedIbTokenAdapter: MockContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const mockedBookKeeper = await smockit(await ethers.getContractFactory("BookKeeper", deployer))

  // Deploy mocked IbTokenAdapter
  const mockedIbTokenAdapter = await smockit(await ethers.getContractFactory("IbTokenAdapter", deployer))

  const SystemDebtEngine = (await ethers.getContractFactory("SystemDebtEngine", deployer)) as SystemDebtEngine__factory
  const systemDebtEngine = (await upgrades.deployProxy(SystemDebtEngine, [
    mockedBookKeeper.address,
  ])) as SystemDebtEngine
  return { systemDebtEngine, mockedBookKeeper, mockedIbTokenAdapter }
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
  let mockedIbTokenAdapter: MockContract

  let systemDebtEngine: SystemDebtEngine
  let systemDebtEngineAsAlice: SystemDebtEngine

  beforeEach(async () => {
    ;({ systemDebtEngine, mockedBookKeeper, mockedIbTokenAdapter } = await waffle.loadFixture(loadFixtureHandler))
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
        expect(calls[0].value).to.be.equal(UnitHelpers.WeiPerRad)
      })
    })
  })

  describe("#cage()", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        await expect(systemDebtEngineAsAlice.cage()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })

    context("when role can access", () => {
      context("caller is owner role ", () => {
        it("should be set live to 0", async () => {
          // grant role access
          await systemDebtEngine.grantRole(await systemDebtEngine.OWNER_ROLE(), aliceAddress)

          expect(await systemDebtEngineAsAlice.live()).to.be.equal(1)

          await expect(systemDebtEngineAsAlice.cage()).to.emit(systemDebtEngineAsAlice, "Cage").withArgs()

          expect(await systemDebtEngineAsAlice.live()).to.be.equal(0)
        })
      })

      context("caller is showStopper role", () => {
        it("should be set live to 0", async () => {
          // grant role access
          await systemDebtEngine.grantRole(await systemDebtEngine.SHOW_STOPPER_ROLE(), aliceAddress)

          expect(await systemDebtEngineAsAlice.live()).to.be.equal(1)

          await expect(systemDebtEngineAsAlice.cage()).to.emit(systemDebtEngineAsAlice, "Cage").withArgs()

          expect(await systemDebtEngineAsAlice.live()).to.be.equal(0)
        })
      })
    })
  })

  describe("#uncage()", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        await expect(systemDebtEngineAsAlice.uncage()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })

    context("when role can access", () => {
      context("caller is owner role ", () => {
        it("should be set live to 1", async () => {
          // grant role access
          await systemDebtEngine.grantRole(await systemDebtEngine.OWNER_ROLE(), aliceAddress)

          expect(await systemDebtEngineAsAlice.live()).to.be.equal(1)

          await systemDebtEngineAsAlice.cage()

          expect(await systemDebtEngineAsAlice.live()).to.be.equal(0)

          await expect(systemDebtEngineAsAlice.uncage()).to.emit(systemDebtEngineAsAlice, "Uncage").withArgs()

          expect(await systemDebtEngineAsAlice.live()).to.be.equal(1)
        })
      })

      context("caller is showStopper role", () => {
        it("should be set live to 1", async () => {
          // grant role access
          await systemDebtEngine.grantRole(await systemDebtEngine.SHOW_STOPPER_ROLE(), aliceAddress)

          expect(await systemDebtEngineAsAlice.live()).to.be.equal(1)

          await systemDebtEngineAsAlice.cage()

          expect(await systemDebtEngineAsAlice.live()).to.be.equal(0)

          await expect(systemDebtEngineAsAlice.uncage()).to.emit(systemDebtEngineAsAlice, "Uncage").withArgs()

          expect(await systemDebtEngineAsAlice.live()).to.be.equal(1)
        })
      })
    })
  })

  describe("#setSurplusBuffer", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(systemDebtEngineAsAlice.setSurplusBuffer(UnitHelpers.WeiPerRad)).to.be.revertedWith("!ownerRole")
      })
    })
    context("when the caller is the owner", async () => {
      it("should be able to call setSurplusBuffer", async () => {
        await systemDebtEngine.grantRole(await systemDebtEngine.OWNER_ROLE(), deployerAddress)
        await expect(systemDebtEngine.setSurplusBuffer(UnitHelpers.WeiPerRad))
          .to.emit(systemDebtEngine, "SetSurplusBuffer")
          .withArgs(deployerAddress, UnitHelpers.WeiPerRad)
      })
    })
  })

  describe("#pause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        await expect(systemDebtEngineAsAlice.pause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          await systemDebtEngine.grantRole(await systemDebtEngine.OWNER_ROLE(), deployerAddress)
          await systemDebtEngine.pause()
        })
      })
    })

    context("and role is gov role", () => {
      it("should be success", async () => {
        await systemDebtEngine.grantRole(await systemDebtEngine.GOV_ROLE(), deployerAddress)
        await systemDebtEngine.pause()
      })
    })

    context("when pause contract", () => {
      it("should be success", async () => {
        await systemDebtEngine.grantRole(await systemDebtEngine.OWNER_ROLE(), deployerAddress)
        await systemDebtEngine.pause()

        await expect(systemDebtEngine.setSurplusBuffer(UnitHelpers.WeiPerRad)).to.be.revertedWith("Pausable: paused")
      })
    })
  })

  describe("#unpause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        await expect(systemDebtEngineAsAlice.unpause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          await systemDebtEngine.grantRole(await systemDebtEngine.OWNER_ROLE(), deployerAddress)
          await systemDebtEngine.pause()
          await systemDebtEngine.unpause()
        })
      })

      context("and role is gov role", () => {
        it("should be success", async () => {
          await systemDebtEngine.grantRole(await systemDebtEngine.GOV_ROLE(), deployerAddress)
          await systemDebtEngine.pause()
          await systemDebtEngine.unpause()
        })
      })
    })

    context("when unpause contract", () => {
      it("should be success", async () => {
        await systemDebtEngine.grantRole(await systemDebtEngine.OWNER_ROLE(), deployerAddress)

        // pause contract
        await systemDebtEngine.pause()

        // unpause contract
        await systemDebtEngine.unpause()

        await expect(systemDebtEngine.setSurplusBuffer(UnitHelpers.WeiPerRad))
          .to.emit(systemDebtEngine, "SetSurplusBuffer")
          .withArgs(deployerAddress, UnitHelpers.WeiPerRad)
      })
    })
  })

  describe("#withdrawCollateralSurplus", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          systemDebtEngineAsAlice.withdrawCollateralSurplus(
            formatBytes32String("BNB"),
            mockedIbTokenAdapter.address,
            deployerAddress,
            UnitHelpers.WeiPerWad
          )
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when the caller is the owner", async () => {
      it("should be able to call withdrawCollateralSurplus", async () => {
        await systemDebtEngine.grantRole(await systemDebtEngine.OWNER_ROLE(), deployerAddress)
        mockedBookKeeper.smocked.moveCollateral.will.return.with()

        await systemDebtEngine.withdrawCollateralSurplus(
          formatBytes32String("BNB"),
          mockedIbTokenAdapter.address,
          deployerAddress,
          UnitHelpers.WeiPerWad
        )

        const { calls: moveCollateral } = mockedBookKeeper.smocked.moveCollateral
        expect(moveCollateral.length).to.be.equal(1)
        expect(moveCollateral[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(moveCollateral[0].src).to.be.equal(systemDebtEngine.address)
        expect(moveCollateral[0].dst).to.be.equal(deployerAddress)
        expect(moveCollateral[0].amount).to.be.equal(UnitHelpers.WeiPerWad)

        const { calls: onMoveCollateral } = mockedIbTokenAdapter.smocked.onMoveCollateral
        expect(onMoveCollateral.length).to.be.equal(1)
        expect(onMoveCollateral[0].source).to.be.equal(systemDebtEngine.address)
        expect(onMoveCollateral[0].destination).to.be.equal(deployerAddress)
        expect(onMoveCollateral[0].share).to.be.equal(UnitHelpers.WeiPerWad)
        expect(onMoveCollateral[0].data).to.be.equal(
          ethers.utils.defaultAbiCoder.encode(["address"], [deployerAddress])
        )
      })
    })
  })

  describe("#withdrawStablecoinSurplus", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          systemDebtEngineAsAlice.withdrawStablecoinSurplus(deployerAddress, UnitHelpers.WeiPerRad)
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when the caller is the owner", async () => {
      it("should be able to call withdrawStablecoinSurplus", async () => {
        await systemDebtEngine.grantRole(await systemDebtEngine.OWNER_ROLE(), deployerAddress)
        mockedBookKeeper.smocked.moveStablecoin.will.return.with()

        await systemDebtEngine.withdrawStablecoinSurplus(deployerAddress, UnitHelpers.WeiPerRad)

        const { calls: moveStablecoin } = mockedBookKeeper.smocked.moveStablecoin
        expect(moveStablecoin.length).to.be.equal(1)
        expect(moveStablecoin[0].src).to.be.equal(systemDebtEngine.address)
        expect(moveStablecoin[0].dst).to.be.equal(deployerAddress)
        expect(moveStablecoin[0].value).to.be.equal(UnitHelpers.WeiPerRad)
      })
    })
  })
})
