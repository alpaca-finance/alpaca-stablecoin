import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { BookKeeper__factory, BookKeeper, StabilityFeeCollector__factory, StabilityFeeCollector } from "../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"

import * as TimeHelpers from "../helper/time"
import * as AssertHelpers from "../helper/assert"
import * as UnitHelpers from "../helper/unit"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants

type fixture = {
  stabilityFeeCollector: StabilityFeeCollector
  mockedBookKeeper: MockContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const BookKeeper = (await ethers.getContractFactory("BookKeeper", deployer)) as BookKeeper__factory
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [])) as BookKeeper
  await bookKeeper.deployed()
  const mockedBookKeeper = await smockit(bookKeeper)

  // Deploy StabilityFeeCollector
  const StabilityFeeCollector = (await ethers.getContractFactory(
    "StabilityFeeCollector",
    deployer
  )) as StabilityFeeCollector__factory
  const stabilityFeeCollector = (await upgrades.deployProxy(StabilityFeeCollector, [
    mockedBookKeeper.address,
  ])) as StabilityFeeCollector

  return { stabilityFeeCollector, mockedBookKeeper }
}

describe("StabilityFeeCollector", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string

  // Contracts
  let mockedBookKeeper: MockContract

  let stabilityFeeCollector: StabilityFeeCollector
  let stabilityFeeCollectorAsDeployer: StabilityFeeCollector
  let stabilityFeeCollectorAsAlice: StabilityFeeCollector

  beforeEach(async () => {
    ;({ stabilityFeeCollector, mockedBookKeeper } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    stabilityFeeCollectorAsDeployer = StabilityFeeCollector__factory.connect(
      stabilityFeeCollector.address,
      deployer
    ) as StabilityFeeCollector

    stabilityFeeCollectorAsAlice = StabilityFeeCollector__factory.connect(
      stabilityFeeCollector.address,
      alice
    ) as StabilityFeeCollector
  })

  describe("#init", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(stabilityFeeCollectorAsAlice.init(ethers.utils.formatBytes32String("BNB"))).to.be.revertedWith(
          "StabilityFeeCollector/not-authorized"
        )
      })
    })
    context("when the caller is the owner", async () => {
      context("when initialize BNB pool", async () => {
        it("should be success", async () => {
          await stabilityFeeCollectorAsDeployer.init(ethers.utils.formatBytes32String("BNB"))
          const pool = await stabilityFeeCollectorAsAlice.collateralPools(ethers.utils.formatBytes32String("BNB"))
          expect(pool.stabilityFeeRate.toString()).equal(UnitHelpers.WeiPerRay)
        })
      })
    })
  })

  describe("#collect", () => {
    context("when call collect", async () => {
      it("should be rate to ~ 1%", async () => {
        await stabilityFeeCollectorAsDeployer.init(ethers.utils.formatBytes32String("BNB"))

        // rate ~ 1% annually
        // r^31536000 = 1.01
        // r =~ 1000000000315522921573372069...
        await stabilityFeeCollectorAsDeployer["file(bytes32,bytes32,uint256)"](
          ethers.utils.formatBytes32String("BNB"),
          ethers.utils.formatBytes32String("stabilityFeeRate"),
          BigNumber.from("1000000000315522921573372069")
        )

        // time increase ~ 1 year
        await TimeHelpers.increase(TimeHelpers.duration.seconds(ethers.BigNumber.from("31536000")))

        // mock bookeeper
        // set debtAccumulatedRate = 1 ray
        mockedBookKeeper.smocked.collateralPools.will.return.with([
          BigNumber.from(0),
          UnitHelpers.WeiPerRay,
          BigNumber.from(0),
          BigNumber.from(0),
          BigNumber.from(0),
        ])
        mockedBookKeeper.smocked.accrueStabilityFee.will.return.with()

        await stabilityFeeCollectorAsAlice.collect(ethers.utils.formatBytes32String("BNB"))

        const { calls } = mockedBookKeeper.smocked.accrueStabilityFee
        expect(calls.length).to.be.equal(1)
        expect(calls[0].collateralPoolId).to.be.equal(ethers.utils.formatBytes32String("BNB"))
        expect(calls[0].u).to.be.equal(AddressZero)
        // rate ~ 0.01 ray ~ 1%
        AssertHelpers.assertAlmostEqual(
          calls[0].debtAccumulatedRate.toString(),
          BigNumber.from("10000000000000000000000000").toString()
        )
      })
    })
  })
})
