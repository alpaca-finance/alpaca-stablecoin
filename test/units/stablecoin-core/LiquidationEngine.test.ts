import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { LiquidationEngine, LiquidationEngine__factory } from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"

import * as TimeHelpers from "../../helper/time"
import * as AssertHelpers from "../../helper/assert"
import { deploy } from "@openzeppelin/hardhat-upgrades/dist/utils"

import * as UnitHelpers from "../../helper/unit"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { formatBytes32String } = ethers.utils

type fixture = {
  liquidationEngine: LiquidationEngine
  mockedBookKeeper: MockContract
  mockedFixedSpreadLiquidationStrategy: MockContract
  mockedSystemDebtEngine: MockContract
  mockedCollateralPoolConfig: MockContract
  mockedAccessControlConfig: MockContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  const mockedAccessControlConfig = await smockit(await ethers.getContractFactory("AccessControlConfig", deployer))

  const mockedCollateralPoolConfig = await smockit(await ethers.getContractFactory("CollateralPoolConfig", deployer))

  // Deploy mocked BookKeeper
  const mockedBookKeeper = await smockit(await ethers.getContractFactory("BookKeeper", deployer))

  // Deploy mocked SystemDebtEngine
  const mockedSystemDebtEngine = await smockit(await ethers.getContractFactory("SystemDebtEngine", deployer))

  // Deploy mocked FixedSpreadLiquidationStrategy
  const mockedFixedSpreadLiquidationStrategy = await smockit(
    await ethers.getContractFactory("FixedSpreadLiquidationStrategy", deployer)
  )

  const LiquidationEngine = (await ethers.getContractFactory(
    "LiquidationEngine",
    deployer
  )) as LiquidationEngine__factory
  const liquidationEngine = (await upgrades.deployProxy(LiquidationEngine, [
    mockedBookKeeper.address,
    mockedSystemDebtEngine.address,
  ])) as LiquidationEngine

  return {
    liquidationEngine,
    mockedBookKeeper,
    mockedFixedSpreadLiquidationStrategy,
    mockedSystemDebtEngine,
    mockedCollateralPoolConfig,
    mockedAccessControlConfig,
  }
}

describe("LiquidationEngine", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string

  // Contracts
  let mockedBookKeeper: MockContract
  let mockedFixedSpreadLiquidationStrategy: MockContract
  let mockedSystemDebtEngine: MockContract
  let mockedCollateralPoolConfig: MockContract
  let mockedAccessControlConfig: MockContract

  let liquidationEngine: LiquidationEngine
  let liquidationEngineAsAlice: LiquidationEngine

  beforeEach(async () => {
    ;({
      liquidationEngine,
      mockedBookKeeper,
      mockedFixedSpreadLiquidationStrategy,
      mockedSystemDebtEngine,
      mockedCollateralPoolConfig,
      mockedAccessControlConfig,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    liquidationEngineAsAlice = LiquidationEngine__factory.connect(liquidationEngine.address, alice) as LiquidationEngine
  })

  describe("#liquidate", () => {
    context("when liquidation engine does not live", () => {
      it("should be revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        await liquidationEngine.cage()
        await expect(
          liquidationEngine.liquidate(
            formatBytes32String("BNB"),
            aliceAddress,
            UnitHelpers.WeiPerWad,
            UnitHelpers.WeiPerWad,
            deployerAddress,
            ethers.utils.defaultAbiCoder.encode(["address", "address"], [deployerAddress, deployerAddress])
          )
        ).to.be.revertedWith("LiquidationEngine/not-live")
      })
    })
    context("when debtShareToRepay == 0", () => {
      it("should be revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        await expect(
          liquidationEngine.liquidate(
            formatBytes32String("BNB"),
            aliceAddress,
            0,
            0,
            deployerAddress,
            ethers.utils.defaultAbiCoder.encode(["address", "address"], [deployerAddress, deployerAddress])
          )
        ).to.be.revertedWith("LiquidationEngine/zero-debt-value-to-be-liquidated")
      })
    })
    context("when liquidation engine colllteral pool does not set strategy", () => {
      it("should be revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        mockedBookKeeper.smocked.positions.will.return.with([
          UnitHelpers.WeiPerWad.mul(10),
          UnitHelpers.WeiPerWad.mul(5),
        ])
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(UnitHelpers.WeiPerRay)
        mockedCollateralPoolConfig.smocked.getPriceWithSafetyMargin.will.return.with(UnitHelpers.WeiPerRay)
        mockedCollateralPoolConfig.smocked.getStrategy.will.return.with(AddressZero)

        await expect(
          liquidationEngine.liquidate(
            formatBytes32String("BNB"),
            aliceAddress,
            UnitHelpers.WeiPerWad,
            UnitHelpers.WeiPerWad,
            deployerAddress,
            ethers.utils.defaultAbiCoder.encode(["address", "address"], [deployerAddress, deployerAddress])
          )
        ).to.be.revertedWith("LiquidationEngine/not-set-strategy")
      })
    })
    // @dev move to integration test
    // context("when position is safe", () => {
    //   it("should be revert", async () => {
    //     mockedBookKeeper.smocked.positions.will.return.with([
    //       UnitHelpers.WeiPerWad.mul(10),
    //       UnitHelpers.WeiPerWad.mul(5),
    //     ])
    //     mockedBookKeeper.smocked.collateralPools.will.return.with({
    //       totalDebtShare: 0,
    //       debtAccumulatedRate: UnitHelpers.WeiPerRay,
    //       priceWithSafetyMargin: UnitHelpers.WeiPerRay,
    //       debtCeiling: 0,
    //       debtFloor: 0,
    //       priceFeed: AddressZero,
    //       liquidationRatio: UnitHelpers.WeiPerRay,
    //       stabilityFeeRate: UnitHelpers.WeiPerRay,
    //       lastAccumulationTime: 0,
    //       adapter: AddressZero,
    //       closeFactorBps: 5000,
    //       liquidatorIncentiveBps: 10250,
    //       treasuryFeesBps: 5000,
    //     })

    //     await liquidationEngine.setStrategy(formatBytes32String("BNB"), mockedFixedSpreadLiquidationStrategy.address)

    //     await expect(
    //       liquidationEngine.liquidate(
    //         formatBytes32String("BNB"),
    //         aliceAddress,
    //         UnitHelpers.WeiPerWad,
    //         UnitHelpers.WeiPerWad,
    //         deployerAddress,
    //         "0x"
    //       )
    //     ).to.be.revertedWith("LiquidationEngine/position-is-safe")
    //   })
    // })
    // context("when liquidating in position", () => {
    //   it("should be able to call liquidate", async () => {
    //     // mock contract
    //     mockedBookKeeper.smocked.positions.will.return.with([
    //       UnitHelpers.WeiPerWad.mul(10),
    //       UnitHelpers.WeiPerWad.mul(10),
    //     ])
    //     mockedCollateralPoolConfig.smocked.collateralPools.will.return.with([
    //       BigNumber.from(0),
    //       UnitHelpers.WeiPerRay.mul(2),
    //       UnitHelpers.WeiPerRay,
    //       BigNumber.from(0),
    //       BigNumber.from(0),
    //     ])
    //     mockedBookKeeper.smocked.moveStablecoin.will.return.with()
    //     mockedFixedSpreadLiquidationStrategy.smocked.execute.will.return.with()

    //     await liquidationEngine.setStrategy(formatBytes32String("BNB"), mockedFixedSpreadLiquidationStrategy.address)

    //     await liquidationEngine.liquidate(
    //       formatBytes32String("BNB"),
    //       aliceAddress,
    //       UnitHelpers.WeiPerWad,
    //       UnitHelpers.WeiPerWad,
    //       deployerAddress,
    //       ethers.utils.defaultAbiCoder.encode(["address", "address"], [deployerAddress, deployerAddress])
    //     )

    //     const { calls: positions } = mockedBookKeeper.smocked.positions
    //     expect(positions.length).to.be.equal(2)
    //     expect(positions[0][0]).to.be.equal(formatBytes32String("BNB"))
    //     expect(positions[0][1]).to.be.equal(aliceAddress)

    //     const { calls: collateralPools } = mockedCollateralPoolConfig.smocked.collateralPools
    //     expect(collateralPools.length).to.be.equal(1)
    //     expect(collateralPools[0][0]).to.be.equal(formatBytes32String("BNB"))

    //     const { calls: moveStablecoin } = mockedBookKeeper.smocked.moveStablecoin
    //     expect(moveStablecoin.length).to.be.equal(1)
    //     expect(moveStablecoin[0].src).to.be.equal(deployerAddress)
    //     expect(moveStablecoin[0].dst).to.be.equal(mockedSystemDebtEngine.address)
    //     expect(moveStablecoin[0].value).to.be.equal(UnitHelpers.WeiPerRad.mul(2))

    //     const { calls: execute } = mockedFixedSpreadLiquidationStrategy.smocked.execute
    //     expect(execute.length).to.be.equal(1)
    //     expect(execute[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
    //     expect(execute[0].positionDebtShare).to.be.equal(UnitHelpers.WeiPerWad.mul(10))
    //     expect(execute[0].positionCollateralAmount).to.be.equal(UnitHelpers.WeiPerWad.mul(10))
    //     expect(execute[0].positionAddress).to.be.equal(aliceAddress)
    //     expect(execute[0].debtShareToRepay).to.be.equal(UnitHelpers.WeiPerWad)
    //     expect(execute[0].data).to.be.equal(
    //       ethers.utils.defaultAbiCoder.encode(["address", "address"], [deployerAddress, deployerAddress])
    //     )
    //   })
    // })
  })

  describe("#cage()", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(liquidationEngineAsAlice.cage()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })

    context("when role can access", () => {
      context("caller is owner role ", () => {
        it("should be set live to 0", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          expect(await liquidationEngineAsAlice.live()).to.be.equal(1)

          await expect(liquidationEngineAsAlice.cage()).to.emit(liquidationEngineAsAlice, "Cage").withArgs()

          expect(await liquidationEngineAsAlice.live()).to.be.equal(0)
        })
      })

      context("caller is showStopper role", () => {
        it("should be set live to 0", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          expect(await liquidationEngineAsAlice.live()).to.be.equal(1)

          await expect(liquidationEngineAsAlice.cage()).to.emit(liquidationEngineAsAlice, "Cage").withArgs()

          expect(await liquidationEngineAsAlice.live()).to.be.equal(0)
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

        await expect(liquidationEngineAsAlice.uncage()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })

    context("when role can access", () => {
      context("caller is owner role ", () => {
        it("should be set live to 1", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          expect(await liquidationEngineAsAlice.live()).to.be.equal(1)

          await liquidationEngineAsAlice.cage()

          expect(await liquidationEngineAsAlice.live()).to.be.equal(0)

          await expect(liquidationEngineAsAlice.uncage()).to.emit(liquidationEngineAsAlice, "Uncage").withArgs()

          expect(await liquidationEngineAsAlice.live()).to.be.equal(1)
        })
      })

      context("caller is showStopper role", () => {
        it("should be set live to 1", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          expect(await liquidationEngineAsAlice.live()).to.be.equal(1)

          await liquidationEngineAsAlice.cage()

          expect(await liquidationEngineAsAlice.live()).to.be.equal(0)

          await expect(liquidationEngineAsAlice.uncage()).to.emit(liquidationEngineAsAlice, "Uncage").withArgs()

          expect(await liquidationEngineAsAlice.live()).to.be.equal(1)
        })
      })
    })
  })

  describe("#pause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(liquidationEngineAsAlice.pause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          await liquidationEngine.pause()
        })
      })
    })

    context("and role is gov role", () => {
      it("should be success", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        await liquidationEngine.pause()
      })
    })

    context("when pause contract", () => {
      it("shouldn't be able to call liquidate", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        await liquidationEngine.pause()

        // mock contract
        mockedBookKeeper.smocked.positions.will.return.with([
          UnitHelpers.WeiPerWad.mul(10),
          UnitHelpers.WeiPerWad.mul(10),
        ])
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(UnitHelpers.WeiPerRay)
        mockedCollateralPoolConfig.smocked.getPriceWithSafetyMargin.will.return.with(UnitHelpers.WeiPerRay)
        mockedCollateralPoolConfig.smocked.getStrategy.will.return.with(mockedFixedSpreadLiquidationStrategy.address)

        mockedFixedSpreadLiquidationStrategy.smocked.execute.will.return.with()

        await expect(
          liquidationEngine.liquidate(
            formatBytes32String("BNB"),
            aliceAddress,
            UnitHelpers.WeiPerWad,
            UnitHelpers.WeiPerWad,
            deployerAddress,
            ethers.utils.defaultAbiCoder.encode(["address", "address"], [deployerAddress, deployerAddress])
          )
        ).to.be.revertedWith("Pausable: paused")
      })
    })
  })

  describe("#unpause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(liquidationEngineAsAlice.unpause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          await liquidationEngine.pause()
          await liquidationEngine.unpause()
        })
      })

      context("and role is gov role", () => {
        it("should be success", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          await liquidationEngine.pause()
          await liquidationEngine.unpause()
        })
      })
    })

    context("when unpause contract", () => {
      it("should liquidate but revert because debt share not decrease", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        // pause contract
        await liquidationEngine.pause()

        // unpause contract
        await liquidationEngine.unpause()

        // mock contract
        mockedBookKeeper.smocked.positions.will.return.with([
          UnitHelpers.WeiPerWad.mul(10),
          UnitHelpers.WeiPerWad.mul(10),
        ])

        mockedFixedSpreadLiquidationStrategy.smocked.execute.will.return.with()

        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(UnitHelpers.WeiPerRay.mul(2))
        mockedCollateralPoolConfig.smocked.getPriceWithSafetyMargin.will.return.with(UnitHelpers.WeiPerRay)
        mockedCollateralPoolConfig.smocked.getStrategy.will.return.with(mockedFixedSpreadLiquidationStrategy.address)

        await expect(
          liquidationEngine.liquidate(
            formatBytes32String("BNB"),
            aliceAddress,
            UnitHelpers.WeiPerWad,
            UnitHelpers.WeiPerWad,
            deployerAddress,
            ethers.utils.defaultAbiCoder.encode(["address", "address"], [deployerAddress, deployerAddress])
          )
        ).to.be.revertedWith("LiquidationEngine/debt-not-liquidated")

        const { calls: positions } = mockedBookKeeper.smocked.positions
        expect(positions.length).to.be.equal(2)
        expect(positions[0][0]).to.be.equal(formatBytes32String("BNB"))
        expect(positions[0][1]).to.be.equal(aliceAddress)

        const { calls: execute } = mockedFixedSpreadLiquidationStrategy.smocked.execute
        expect(execute.length).to.be.equal(1)
        expect(execute[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(execute[0]._positionDebtShare).to.be.equal(UnitHelpers.WeiPerWad.mul(10))
        expect(execute[0]._positionCollateralAmount).to.be.equal(UnitHelpers.WeiPerWad.mul(10))
        expect(execute[0]._positionAddress).to.be.equal(aliceAddress)
        expect(execute[0]._debtShareToBeLiquidated).to.be.equal(UnitHelpers.WeiPerWad)
        expect(execute[0]._maxDebtShareToBeLiquidated).to.be.equal(UnitHelpers.WeiPerWad)
        expect(execute[0]._liquidatorAddress).to.be.equal(deployerAddress)
        expect(execute[0]._collateralRecipient).to.be.equal(deployerAddress)
        expect(execute[0]._data).to.be.equal(
          ethers.utils.defaultAbiCoder.encode(["address", "address"], [deployerAddress, deployerAddress])
        )
      })
    })
  })
})
