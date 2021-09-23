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
  mockedAuctioneer: MockContract
  mockedSystemDebtEngine: MockContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const mockedBookKeeper = await smockit(await ethers.getContractFactory("BookKeeper", deployer))

  const mockedAuctioneer = await smockit(await ethers.getContractFactory("CollateralAuctioneer", deployer))

  const mockedSystemDebtEngine = await smockit(await ethers.getContractFactory("SystemDebtEngine", deployer))

  const LiquidationEngine = (await ethers.getContractFactory(
    "LiquidationEngine",
    deployer
  )) as LiquidationEngine__factory
  const liquidationEngine = (await upgrades.deployProxy(LiquidationEngine, [
    mockedBookKeeper.address,
  ])) as LiquidationEngine

  return { liquidationEngine, mockedBookKeeper, mockedAuctioneer, mockedSystemDebtEngine }
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
  let mockedAuctioneer: MockContract
  let mockedSystemDebtEngine: MockContract

  let liquidationEngine: LiquidationEngine
  let liquidationEngineAsAlice: LiquidationEngine

  beforeEach(async () => {
    ;({ liquidationEngine, mockedBookKeeper, mockedAuctioneer, mockedSystemDebtEngine } = await waffle.loadFixture(
      loadFixtureHandler
    ))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    liquidationEngineAsAlice = LiquidationEngine__factory.connect(liquidationEngine.address, alice) as LiquidationEngine
  })

  describe("#startLiquidation", () => {
    context("when liquidation engine does not live", () => {
      it("should be revert", async () => {
        await liquidationEngine.cage()
        await expect(
          liquidationEngine.startLiquidation(formatBytes32String("BNB"), aliceAddress, deployerAddress)
        ).to.be.revertedWith("LiquidationEngine/not-live")
      })
    })
    context("when position is safe", () => {
      it("should be revert", async () => {
        mockedBookKeeper.smocked.positions.will.return.with([
          UnitHelpers.WeiPerWad.mul(10),
          UnitHelpers.WeiPerWad.mul(5),
        ])
        mockedBookKeeper.smocked.collateralPools.will.return.with([
          BigNumber.from(0),
          UnitHelpers.WeiPerRay,
          UnitHelpers.WeiPerRay,
          BigNumber.from(0),
          BigNumber.from(0),
        ])

        await expect(
          liquidationEngine.startLiquidation(formatBytes32String("BNB"), aliceAddress, deployerAddress)
        ).to.be.revertedWith("LiquidationEngine/not-unsafe")
      })
    })
    context("when stablecoin needed for debt repay over max size", () => {
      it("should be revert", async () => {
        mockedBookKeeper.smocked.positions.will.return.with([
          UnitHelpers.WeiPerWad.mul(10),
          UnitHelpers.WeiPerWad.mul(10),
        ])
        mockedBookKeeper.smocked.collateralPools.will.return.with([
          BigNumber.from(0),
          UnitHelpers.WeiPerRay.mul(2),
          UnitHelpers.WeiPerRay,
          BigNumber.from(0),
          BigNumber.from(0),
        ])

        await liquidationEngine["file(bytes32,uint256)"](
          formatBytes32String("liquidationMaxSize"),
          UnitHelpers.WeiPerRad.mul(10)
        )

        await expect(
          liquidationEngine.startLiquidation(formatBytes32String("BNB"), aliceAddress, deployerAddress)
        ).to.be.revertedWith("LiquidationEngine/liquidation-limit-hit")
      })
      it("should be revert", async () => {
        // mock contract
        mockedBookKeeper.smocked.positions.will.return.with([
          UnitHelpers.WeiPerWad.mul(10),
          UnitHelpers.WeiPerWad.mul(10),
        ])
        mockedBookKeeper.smocked.collateralPools.will.return.with([
          BigNumber.from(0),
          UnitHelpers.WeiPerRay.mul(2),
          UnitHelpers.WeiPerRay,
          BigNumber.from(0),
          BigNumber.from(0),
        ])

        // set liquidationMaxSize 10 rad
        await liquidationEngine["file(bytes32,bytes32,uint256)"](
          formatBytes32String("BNB"),
          formatBytes32String("liquidationMaxSize"),
          UnitHelpers.WeiPerRad.mul(10)
        )

        await expect(
          liquidationEngine.startLiquidation(formatBytes32String("BNB"), aliceAddress, deployerAddress)
        ).to.be.revertedWith("LiquidationEngine/liquidation-limit-hit")
      })
    })
    context("when liquidating all in position", () => {
      it("should be able to call startLiquidation", async () => {
        // mock contract
        mockedBookKeeper.smocked.positions.will.return.with([
          UnitHelpers.WeiPerWad.mul(10),
          UnitHelpers.WeiPerWad.mul(10),
        ])
        mockedBookKeeper.smocked.collateralPools.will.return.with([
          BigNumber.from(0),
          UnitHelpers.WeiPerRay.mul(2),
          UnitHelpers.WeiPerRay,
          BigNumber.from(0),
          BigNumber.from(0),
        ])
        mockedAuctioneer.smocked.collateralPoolId.will.return.with(formatBytes32String("BNB"))
        mockedAuctioneer.smocked.startAuction.will.return.with(1)

        // set systemDebtEngine
        await liquidationEngine["file(bytes32,address)"](
          formatBytes32String("systemDebtEngine"),
          mockedSystemDebtEngine.address
        )
        // set auctioneer
        await liquidationEngine["file(bytes32,bytes32,address)"](
          formatBytes32String("BNB"),
          formatBytes32String("auctioneer"),
          mockedAuctioneer.address
        )
        // set liquidationMaxSize 100 rad
        await liquidationEngine["file(bytes32,uint256)"](
          formatBytes32String("liquidationMaxSize"),
          UnitHelpers.WeiPerRad.mul(100)
        )
        // set liquidationMaxSize pool 100 rad
        await liquidationEngine["file(bytes32,bytes32,uint256)"](
          formatBytes32String("BNB"),
          formatBytes32String("liquidationMaxSize"),
          UnitHelpers.WeiPerRad.mul(100)
        )
        // set liquidationPenalty 10 %
        await liquidationEngine["file(bytes32,bytes32,uint256)"](
          formatBytes32String("BNB"),
          formatBytes32String("liquidationPenalty"),
          UnitHelpers.WeiPerWad.add(UnitHelpers.WeiPerWad.div(10))
        )

        await expect(liquidationEngine.startLiquidation(formatBytes32String("BNB"), aliceAddress, deployerAddress))
          .to.emit(liquidationEngine, "StartLiquidation")
          .withArgs(
            formatBytes32String("BNB"),
            aliceAddress,
            UnitHelpers.WeiPerWad.mul(10),
            UnitHelpers.WeiPerWad.mul(10),
            UnitHelpers.WeiPerRad.mul(20),
            mockedAuctioneer.address,
            1
          )

        const { calls: confiscatePositionCalls } = mockedBookKeeper.smocked.confiscatePosition
        expect(confiscatePositionCalls[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(confiscatePositionCalls[0].positionAddress).to.be.equal(aliceAddress)
        expect(confiscatePositionCalls[0].collateralCreditor).to.be.equal(mockedAuctioneer.address)
        expect(confiscatePositionCalls[0].stablecoinDebtor).to.be.equal(mockedSystemDebtEngine.address)
        expect(confiscatePositionCalls[0].collateralAmount).to.be.equal(UnitHelpers.WeiPerWad.mul(-10))
        expect(confiscatePositionCalls[0].debtShare).to.be.equal(UnitHelpers.WeiPerWad.mul(-10))

        const { calls: startAuctionCalls } = mockedAuctioneer.smocked.startAuction
        expect(startAuctionCalls.length).to.be.equal(1)
        // debtValueToBeLiquidatedWithPenalty = debtValue * penalty = (10 wad * 2 ray) * 10% = 2.2 rad
        expect(startAuctionCalls[0].debt).to.be.equal(BigNumber.from("22000000000000000000000000000000000000000000000"))
        expect(startAuctionCalls[0].collateralAmount).to.be.equal(UnitHelpers.WeiPerWad.mul(10))
        expect(startAuctionCalls[0].positionAddress).to.be.equal(aliceAddress)
        expect(startAuctionCalls[0].liquidatorAddress).to.be.equal(deployerAddress)
      })
    })
    context("when liquidating some in position", () => {
      it("should be able to call startLiquidation", async () => {
        // mock contract
        mockedBookKeeper.smocked.positions.will.return.with([
          UnitHelpers.WeiPerWad.mul(10),
          UnitHelpers.WeiPerWad.mul(10),
        ])
        mockedBookKeeper.smocked.collateralPools.will.return.with([
          BigNumber.from(0),
          UnitHelpers.WeiPerRay.mul(2),
          UnitHelpers.WeiPerRay,
          BigNumber.from(0),
          BigNumber.from(0),
        ])
        mockedAuctioneer.smocked.collateralPoolId.will.return.with(formatBytes32String("BNB"))
        mockedAuctioneer.smocked.startAuction.will.return.with(1)

        // set systemDebtEngine
        await liquidationEngine["file(bytes32,address)"](
          formatBytes32String("systemDebtEngine"),
          mockedSystemDebtEngine.address
        )
        // set auctioneer
        await liquidationEngine["file(bytes32,bytes32,address)"](
          formatBytes32String("BNB"),
          formatBytes32String("auctioneer"),
          mockedAuctioneer.address
        )
        // set liquidationMaxSize 100 rad
        await liquidationEngine["file(bytes32,uint256)"](
          formatBytes32String("liquidationMaxSize"),
          UnitHelpers.WeiPerRad.mul(100)
        )
        // set liquidationMaxSize pool 100 rad
        await liquidationEngine["file(bytes32,bytes32,uint256)"](
          formatBytes32String("BNB"),
          formatBytes32String("liquidationMaxSize"),
          UnitHelpers.WeiPerRad.mul(10)
        )
        // set liquidationPenalty 10 %
        await liquidationEngine["file(bytes32,bytes32,uint256)"](
          formatBytes32String("BNB"),
          formatBytes32String("liquidationPenalty"),
          UnitHelpers.WeiPerWad.add(UnitHelpers.WeiPerWad.div(10))
        )

        await expect(liquidationEngine.startLiquidation(formatBytes32String("BNB"), aliceAddress, deployerAddress))
          .to.emit(liquidationEngine, "StartLiquidation")
          .withArgs(
            formatBytes32String("BNB"),
            aliceAddress,
            BigNumber.from("4545454545454545454"),
            BigNumber.from("4545454545454545454"),
            BigNumber.from("9090909090909090908000000000000000000000000000"),
            mockedAuctioneer.address,
            1
          )

        const { calls: confiscatePositionCalls } = mockedBookKeeper.smocked.confiscatePosition
        expect(confiscatePositionCalls[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(confiscatePositionCalls[0].positionAddress).to.be.equal(aliceAddress)
        expect(confiscatePositionCalls[0].collateralCreditor).to.be.equal(mockedAuctioneer.address)
        expect(confiscatePositionCalls[0].stablecoinDebtor).to.be.equal(mockedSystemDebtEngine.address)
        // collateralAmountToBeLiquidated = positionLockedCollateral * debtShareToBeLiquidated / positionDebtShare = 10 wad * ~4.5454 wad / 10 wad = ~4.5454 wad
        expect(confiscatePositionCalls[0].collateralAmount).to.be.equal(BigNumber.from("-4545454545454545454"))
        // debtShareToBeLiquidated = debtSize / debtAccumulatedRate / penalty = 10 rad / 2 ray / 110% = ~4.5454 wad
        expect(confiscatePositionCalls[0].debtShare).to.be.equal(BigNumber.from("-4545454545454545454"))

        const { calls: startAuctionCalls } = mockedAuctioneer.smocked.startAuction
        expect(startAuctionCalls.length).to.be.equal(1)
        // debtValueToBeLiquidatedWithPenalty = debtValue * penalty = (~4.5454 wad * 2 ray) * 110% = ~9.9999 rad
        expect(startAuctionCalls[0].debt).to.be.equal(BigNumber.from("9999999999999999998800000000000000000000000000"))
        expect(startAuctionCalls[0].collateralAmount).to.be.equal(BigNumber.from("4545454545454545454"))
        expect(startAuctionCalls[0].positionAddress).to.be.equal(aliceAddress)
        expect(startAuctionCalls[0].liquidatorAddress).to.be.equal(deployerAddress)
      })
      context("when position debt value left < debt floor ", () => {
        it("should be able to call startLiquidation", async () => {
          // mock contract
          mockedBookKeeper.smocked.positions.will.return.with([
            UnitHelpers.WeiPerWad.mul(10),
            UnitHelpers.WeiPerWad.mul(10),
          ])
          mockedBookKeeper.smocked.collateralPools.will.return.with([
            BigNumber.from(0),
            UnitHelpers.WeiPerRay.mul(2),
            UnitHelpers.WeiPerRay,
            BigNumber.from(0),
            UnitHelpers.WeiPerRad.mul(11),
          ])
          mockedAuctioneer.smocked.collateralPoolId.will.return.with(formatBytes32String("BNB"))
          mockedAuctioneer.smocked.startAuction.will.return.with(1)

          // set systemDebtEngine
          await liquidationEngine["file(bytes32,address)"](
            formatBytes32String("systemDebtEngine"),
            mockedSystemDebtEngine.address
          )
          // set auctioneer
          await liquidationEngine["file(bytes32,bytes32,address)"](
            formatBytes32String("BNB"),
            formatBytes32String("auctioneer"),
            mockedAuctioneer.address
          )
          // set liquidationMaxSize 100 rad
          await liquidationEngine["file(bytes32,uint256)"](
            formatBytes32String("liquidationMaxSize"),
            UnitHelpers.WeiPerRad.mul(100)
          )
          // set liquidationMaxSize pool 100 rad
          await liquidationEngine["file(bytes32,bytes32,uint256)"](
            formatBytes32String("BNB"),
            formatBytes32String("liquidationMaxSize"),
            UnitHelpers.WeiPerRad.mul(10)
          )
          // set liquidationPenalty 10 %
          await liquidationEngine["file(bytes32,bytes32,uint256)"](
            formatBytes32String("BNB"),
            formatBytes32String("liquidationPenalty"),
            UnitHelpers.WeiPerWad.add(UnitHelpers.WeiPerWad.div(10))
          )

          await expect(liquidationEngine.startLiquidation(formatBytes32String("BNB"), aliceAddress, deployerAddress))
            .to.emit(liquidationEngine, "StartLiquidation")
            .withArgs(
              formatBytes32String("BNB"),
              aliceAddress,
              UnitHelpers.WeiPerWad.mul(10),
              UnitHelpers.WeiPerWad.mul(10),
              UnitHelpers.WeiPerRad.mul(20),
              mockedAuctioneer.address,
              1
            )

          const { calls: confiscatePositionCalls } = mockedBookKeeper.smocked.confiscatePosition
          expect(confiscatePositionCalls[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
          expect(confiscatePositionCalls[0].positionAddress).to.be.equal(aliceAddress)
          expect(confiscatePositionCalls[0].collateralCreditor).to.be.equal(mockedAuctioneer.address)
          expect(confiscatePositionCalls[0].stablecoinDebtor).to.be.equal(mockedSystemDebtEngine.address)
          expect(confiscatePositionCalls[0].collateralAmount).to.be.equal(UnitHelpers.WeiPerWad.mul(-10))
          expect(confiscatePositionCalls[0].debtShare).to.be.equal(UnitHelpers.WeiPerWad.mul(-10))

          const { calls: startAuctionCalls } = mockedAuctioneer.smocked.startAuction
          expect(startAuctionCalls.length).to.be.equal(1)
          // debtValueToBeLiquidatedWithPenalty = debtValue * penalty = (10 wad * 2 ray) * 10% = 2.2 red
          expect(startAuctionCalls[0].debt).to.be.equal(
            BigNumber.from("22000000000000000000000000000000000000000000000")
          )
          expect(startAuctionCalls[0].collateralAmount).to.be.equal(UnitHelpers.WeiPerWad.mul(10))
          expect(startAuctionCalls[0].positionAddress).to.be.equal(aliceAddress)
          expect(startAuctionCalls[0].liquidatorAddress).to.be.equal(deployerAddress)
        })
      })
    })
  })

  describe("#cage", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await liquidationEngine.grantRole(await liquidationEngine.SHOW_STOPPER_ROLE(), deployerAddress)
        await expect(liquidationEngineAsAlice.cage()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })
    context("when parameters are valid", () => {
      it("should be able to call cage", async () => {
        await liquidationEngine.grantRole(await liquidationEngine.OWNER_ROLE(), deployerAddress)

        const liveBefore = await liquidationEngine.live()
        expect(liveBefore).to.be.equal(1)

        await liquidationEngine.cage()

        const liveAfter = await liquidationEngine.live()
        expect(liveAfter).to.be.equal(0)
      })
    })
  })

  describe("#pause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        await expect(liquidationEngineAsAlice.pause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          await liquidationEngine.grantRole(await liquidationEngine.OWNER_ROLE(), deployerAddress)
          await liquidationEngine.pause()
        })
      })
    })

    context("and role is gov role", () => {
      it("should be success", async () => {
        await liquidationEngine.grantRole(await liquidationEngine.GOV_ROLE(), deployerAddress)
        await liquidationEngine.pause()
      })
    })

    context("when pause contract", () => {
      it("should be success", async () => {
        await liquidationEngine.grantRole(await liquidationEngine.OWNER_ROLE(), deployerAddress)
        await liquidationEngine.pause()

        await liquidationEngine.grantRole(await liquidationEngine.AUCTIONEER_ROLE(), deployerAddress)

        // mock contract
        mockedBookKeeper.smocked.positions.will.return.with([
          UnitHelpers.WeiPerWad.mul(10),
          UnitHelpers.WeiPerWad.mul(10),
        ])
        mockedBookKeeper.smocked.collateralPools.will.return.with([
          BigNumber.from(0),
          UnitHelpers.WeiPerRay.mul(2),
          UnitHelpers.WeiPerRay,
          BigNumber.from(0),
          BigNumber.from(0),
        ])
        mockedAuctioneer.smocked.collateralPoolId.will.return.with(formatBytes32String("BNB"))
        mockedAuctioneer.smocked.startAuction.will.return.with(1)

        // set systemDebtEngine
        await liquidationEngine["file(bytes32,address)"](
          formatBytes32String("systemDebtEngine"),
          mockedSystemDebtEngine.address
        )
        // set auctioneer
        await liquidationEngine["file(bytes32,bytes32,address)"](
          formatBytes32String("BNB"),
          formatBytes32String("auctioneer"),
          mockedAuctioneer.address
        )
        // set liquidationMaxSize 100 rad
        await liquidationEngine["file(bytes32,uint256)"](
          formatBytes32String("liquidationMaxSize"),
          UnitHelpers.WeiPerRad.mul(100)
        )
        // set liquidationMaxSize pool 100 rad
        await liquidationEngine["file(bytes32,bytes32,uint256)"](
          formatBytes32String("BNB"),
          formatBytes32String("liquidationMaxSize"),
          UnitHelpers.WeiPerRad.mul(100)
        )
        // set liquidationPenalty 10 %
        await liquidationEngine["file(bytes32,bytes32,uint256)"](
          formatBytes32String("BNB"),
          formatBytes32String("liquidationPenalty"),
          UnitHelpers.WeiPerWad.add(UnitHelpers.WeiPerWad.div(10))
        )

        await liquidationEngine.startLiquidation(formatBytes32String("BNB"), aliceAddress, deployerAddress)

        await expect(
          liquidationEngine.removeRepaidDebtFromAuction(formatBytes32String("BNB"), UnitHelpers.WeiPerRad)
        ).to.be.revertedWith("Pausable: paused")
      })
    })
  })

  describe("#unpause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        await expect(liquidationEngineAsAlice.unpause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          await liquidationEngine.grantRole(await liquidationEngine.OWNER_ROLE(), deployerAddress)
          await liquidationEngine.pause()
          await liquidationEngine.unpause()
        })
      })

      context("and role is gov role", () => {
        it("should be success", async () => {
          await liquidationEngine.grantRole(await liquidationEngine.GOV_ROLE(), deployerAddress)
          await liquidationEngine.pause()
          await liquidationEngine.unpause()
        })
      })
    })

    context("when unpause contract", () => {
      it("should be success", async () => {
        await liquidationEngine.grantRole(await liquidationEngine.OWNER_ROLE(), deployerAddress)

        // pause contract
        await liquidationEngine.pause()

        // unpause contract
        await liquidationEngine.unpause()

        await liquidationEngine.grantRole(await liquidationEngine.AUCTIONEER_ROLE(), deployerAddress)

        // mock contract
        mockedBookKeeper.smocked.positions.will.return.with([
          UnitHelpers.WeiPerWad.mul(10),
          UnitHelpers.WeiPerWad.mul(10),
        ])
        mockedBookKeeper.smocked.collateralPools.will.return.with([
          BigNumber.from(0),
          UnitHelpers.WeiPerRay.mul(2),
          UnitHelpers.WeiPerRay,
          BigNumber.from(0),
          BigNumber.from(0),
        ])
        mockedAuctioneer.smocked.collateralPoolId.will.return.with(formatBytes32String("BNB"))
        mockedAuctioneer.smocked.startAuction.will.return.with(1)

        // set systemDebtEngine
        await liquidationEngine["file(bytes32,address)"](
          formatBytes32String("systemDebtEngine"),
          mockedSystemDebtEngine.address
        )
        // set auctioneer
        await liquidationEngine["file(bytes32,bytes32,address)"](
          formatBytes32String("BNB"),
          formatBytes32String("auctioneer"),
          mockedAuctioneer.address
        )
        // set liquidationMaxSize 100 rad
        await liquidationEngine["file(bytes32,uint256)"](
          formatBytes32String("liquidationMaxSize"),
          UnitHelpers.WeiPerRad.mul(100)
        )
        // set liquidationMaxSize pool 100 rad
        await liquidationEngine["file(bytes32,bytes32,uint256)"](
          formatBytes32String("BNB"),
          formatBytes32String("liquidationMaxSize"),
          UnitHelpers.WeiPerRad.mul(100)
        )
        // set liquidationPenalty 10 %
        await liquidationEngine["file(bytes32,bytes32,uint256)"](
          formatBytes32String("BNB"),
          formatBytes32String("liquidationPenalty"),
          UnitHelpers.WeiPerWad.add(UnitHelpers.WeiPerWad.div(10))
        )

        await liquidationEngine.startLiquidation(formatBytes32String("BNB"), aliceAddress, deployerAddress)

        await expect(liquidationEngine.removeRepaidDebtFromAuction(formatBytes32String("BNB"), UnitHelpers.WeiPerRad))
          .to.emit(liquidationEngine, "RemoveRepaidDebtFromAuction")
          .withArgs(formatBytes32String("BNB"), UnitHelpers.WeiPerRad)
      })
    })
  })

  describe("#removeRepaidDebtFromAuction", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await liquidationEngine.grantRole(await liquidationEngine.AUCTIONEER_ROLE(), deployerAddress)
        await expect(
          liquidationEngineAsAlice.removeRepaidDebtFromAuction(formatBytes32String("BNB"), UnitHelpers.WeiPerRad)
        ).to.be.revertedWith("!auctioneerRole")
      })
    })
    context("when parameters are valid", () => {
      it("should be able to call removeRepaidDebtFromAuction", async () => {
        await liquidationEngine.grantRole(await liquidationEngine.AUCTIONEER_ROLE(), deployerAddress)

        // mock contract
        mockedBookKeeper.smocked.positions.will.return.with([
          UnitHelpers.WeiPerWad.mul(10),
          UnitHelpers.WeiPerWad.mul(10),
        ])
        mockedBookKeeper.smocked.collateralPools.will.return.with([
          BigNumber.from(0),
          UnitHelpers.WeiPerRay.mul(2),
          UnitHelpers.WeiPerRay,
          BigNumber.from(0),
          BigNumber.from(0),
        ])
        mockedAuctioneer.smocked.collateralPoolId.will.return.with(formatBytes32String("BNB"))
        mockedAuctioneer.smocked.startAuction.will.return.with(1)

        // set systemDebtEngine
        await liquidationEngine["file(bytes32,address)"](
          formatBytes32String("systemDebtEngine"),
          mockedSystemDebtEngine.address
        )
        // set auctioneer
        await liquidationEngine["file(bytes32,bytes32,address)"](
          formatBytes32String("BNB"),
          formatBytes32String("auctioneer"),
          mockedAuctioneer.address
        )
        // set liquidationMaxSize 100 rad
        await liquidationEngine["file(bytes32,uint256)"](
          formatBytes32String("liquidationMaxSize"),
          UnitHelpers.WeiPerRad.mul(100)
        )
        // set liquidationMaxSize pool 100 rad
        await liquidationEngine["file(bytes32,bytes32,uint256)"](
          formatBytes32String("BNB"),
          formatBytes32String("liquidationMaxSize"),
          UnitHelpers.WeiPerRad.mul(100)
        )
        // set liquidationPenalty 10 %
        await liquidationEngine["file(bytes32,bytes32,uint256)"](
          formatBytes32String("BNB"),
          formatBytes32String("liquidationPenalty"),
          UnitHelpers.WeiPerWad.add(UnitHelpers.WeiPerWad.div(10))
        )

        await liquidationEngine.startLiquidation(formatBytes32String("BNB"), aliceAddress, deployerAddress)

        await expect(liquidationEngine.removeRepaidDebtFromAuction(formatBytes32String("BNB"), UnitHelpers.WeiPerRad))
          .to.emit(liquidationEngine, "RemoveRepaidDebtFromAuction")
          .withArgs(formatBytes32String("BNB"), UnitHelpers.WeiPerRad)
      })
    })
  })
})
