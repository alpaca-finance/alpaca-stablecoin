import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import {
  BookKeeper__factory,
  BookKeeper,
  StabilityFeeCollector__factory,
  StabilityFeeCollector,
  CollateralPoolConfig,
  CollateralPoolConfig__factory,
  SimplePriceFeed,
  SimplePriceFeed__factory,
  TokenAdapter__factory,
  TokenAdapter,
  BEP20,
  BEP20__factory,
  AccessControlConfig__factory,
  AccessControlConfig,
} from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"

import * as TimeHelpers from "../../helper/time"
import * as AssertHelpers from "../../helper/assert"
import * as UnitHelpers from "../../helper/unit"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { formatBytes32String } = ethers.utils

type fixture = {
  stabilityFeeCollector: StabilityFeeCollector
  mockedBookKeeper: MockContract
  mockedCollateralPoolConfig: MockContract
  mockedAccessControlConfig: MockContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  const mockedAccessControlConfig = await smockit(await ethers.getContractFactory("AccessControlConfig", deployer))

  const mockedCollateralPoolConfig = await smockit(await ethers.getContractFactory("CollateralPoolConfig", deployer))

  const mockedBookKeeper = await smockit(await ethers.getContractFactory("BookKeeper", deployer))

  const mockedSimplePriceFeed = await smockit(await ethers.getContractFactory("SimplePriceFeed", deployer))

  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const bep20 = await BEP20.deploy("BTOKEN", "BTOKEN")

  const tokenAdapter = await smockit(await ethers.getContractFactory("TokenAdapter", deployer))

  // Deploy StabilityFeeCollector
  const StabilityFeeCollector = (await ethers.getContractFactory(
    "StabilityFeeCollector",
    deployer
  )) as StabilityFeeCollector__factory
  const stabilityFeeCollector = (await upgrades.deployProxy(StabilityFeeCollector, [
    mockedBookKeeper.address,
    deployer.address,
  ])) as StabilityFeeCollector

  return { stabilityFeeCollector, mockedBookKeeper, mockedCollateralPoolConfig, mockedAccessControlConfig }
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
  let mockedCollateralPoolConfig: MockContract
  let mockedAccessControlConfig: MockContract

  let stabilityFeeCollector: StabilityFeeCollector
  let stabilityFeeCollectorAsAlice: StabilityFeeCollector

  beforeEach(async () => {
    ;({ stabilityFeeCollector, mockedBookKeeper, mockedCollateralPoolConfig, mockedAccessControlConfig } =
      await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    stabilityFeeCollectorAsAlice = StabilityFeeCollector__factory.connect(
      stabilityFeeCollector.address,
      alice
    ) as StabilityFeeCollector
  })

  describe("#collect", () => {
    context("when call collect", async () => {
      it("should be rate to ~ 1%", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)

        // rate ~ 1% annually
        // r^31536000 = 1.01
        // r =~ 1000000000315522921573372069...
        mockedCollateralPoolConfig.smocked.getStabilityFeeRate.will.return.with(
          BigNumber.from("1000000000315522921573372069")
        )

        // time increase 1 year
        mockedCollateralPoolConfig.smocked.getLastAccumulationTime.will.return.with(await TimeHelpers.latest())
        await TimeHelpers.increase(TimeHelpers.duration.seconds(ethers.BigNumber.from("31536000")))
        // mock bookeeper
        // set debtAccumulatedRate = 1 ray
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(UnitHelpers.WeiPerRay)

        // rate ~ 0.01 ray ~ 1%
        mockedBookKeeper.smocked.accrueStabilityFee.will.return.with()
        await stabilityFeeCollectorAsAlice.collect(formatBytes32String("BNB"))
        const { calls } = mockedBookKeeper.smocked.accrueStabilityFee
        expect(calls.length).to.be.equal(1)
        expect(calls[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(calls[0]._stabilityFeeRecipient).to.be.equal(deployerAddress)
        // rate ~ 0.01 ray ~ 1%
        AssertHelpers.assertAlmostEqual(
          calls[0]._debtAccumulatedRate.toString(),
          BigNumber.from("10000000000000000000000000").toString()
        )
      })
    })
  })

  describe("#setGlobalStabilityFeeRate", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(stabilityFeeCollectorAsAlice.setGlobalStabilityFeeRate(UnitHelpers.WeiPerWad)).to.be.revertedWith(
          "!ownerRole"
        )
      })
    })
    context("when the caller is the owner", async () => {
      it("should be able to call setGlobalStabilityFeeRate", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        await expect(stabilityFeeCollector.setGlobalStabilityFeeRate(UnitHelpers.WeiPerRay))
          .to.emit(stabilityFeeCollector, "LogSetGlobalStabilityFeeRate")
          .withArgs(deployerAddress, UnitHelpers.WeiPerRay)
      })
    })
  })

  describe("#setSystemDebtEngine", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(stabilityFeeCollectorAsAlice.setSystemDebtEngine(mockedBookKeeper.address)).to.be.revertedWith(
          "!ownerRole"
        )
      })
    })
    context("when the caller is the owner", async () => {
      it("should be able to call setSystemDebtEngine", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        await expect(stabilityFeeCollector.setSystemDebtEngine(mockedBookKeeper.address))
          .to.emit(stabilityFeeCollector, "LogSetSystemDebtEngine")
          .withArgs(deployerAddress, mockedBookKeeper.address)
      })
    })
  })

  describe("#pause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(stabilityFeeCollectorAsAlice.pause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          await stabilityFeeCollector.pause()
        })
      })
    })

    context("and role is gov role", () => {
      it("should be success", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        await stabilityFeeCollector.pause()
      })
    })
  })

  describe("#unpause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(stabilityFeeCollectorAsAlice.unpause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          await stabilityFeeCollector.pause()
          await stabilityFeeCollector.unpause()
        })
      })

      context("and role is gov role", () => {
        it("should be success", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          await stabilityFeeCollector.pause()
          await stabilityFeeCollector.unpause()
        })
      })
    })

    context("when unpause contract", () => {
      it("should be success", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        // pause contract
        await stabilityFeeCollector.pause()

        // unpause contract
        await stabilityFeeCollector.unpause()

        await stabilityFeeCollector.collect(formatBytes32String("BNB"))
      })
    })
  })
})
