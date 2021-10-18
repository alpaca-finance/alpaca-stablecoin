import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber } from "ethers"
import chai from "chai"
import { solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import {
  PriceOracle,
  PriceOracle__factory,
  AccessControlConfig,
  AccessControlConfig__factory,
  CollateralPoolConfig__factory,
  CollateralPoolConfig,
} from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"

import { formatBytes32BigNumber } from "../../helper/format"
import { WeiPerRay } from "../../helper/unit"
import { AddressZero } from "../../helper/address"

chai.use(solidity)
const { expect } = chai
const { One } = ethers.constants
const { formatBytes32String } = ethers.utils

type fixture = {
  priceOracle: PriceOracle
  mockedBookKeeper: MockContract
  mockedPriceFeed: MockContract
  mockedCollateralPoolConfig: MockContract
  mockedAccessControlConfig: MockContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  const AccessControlConfig = (await ethers.getContractFactory(
    "AccessControlConfig",
    deployer
  )) as AccessControlConfig__factory

  const mockedAccessControlConfig = await smockit(await ethers.getContractFactory("AccessControlConfig", deployer))
  const mockedCollateralPoolConfig = await smockit(await ethers.getContractFactory("CollateralPoolConfig", deployer))

  // Deploy mocked BookKeeper
  const mockedBookKeeper = await smockit(await ethers.getContractFactory("BookKeeper", deployer))

  // Deploy mocked PriceFeed
  const mockedPriceFeed = await smockit(await ethers.getContractFactory("MockPriceFeed", deployer))

  // Deploy PriceOracle
  const PriceOracle = (await ethers.getContractFactory("PriceOracle", deployer)) as PriceOracle__factory
  const priceOracle = (await upgrades.deployProxy(PriceOracle, [mockedBookKeeper.address])) as PriceOracle
  await priceOracle.deployed()

  return {
    priceOracle,
    mockedBookKeeper,
    mockedPriceFeed,
    mockedCollateralPoolConfig,
    mockedAccessControlConfig,
  }
}

describe("PriceOracle", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string

  // Contracts
  let mockedBookKeeper: MockContract
  let mockedPriceFeed: MockContract
  let mockedCollateralPoolConfig: MockContract
  let mockedAccessControlConfig: MockContract

  let priceOracle: PriceOracle
  let priceOracleAsAlice: PriceOracle

  beforeEach(async () => {
    ;({
      priceOracle,
      mockedBookKeeper,
      mockedPriceFeed,
      // collateralPoolConfig,
      mockedCollateralPoolConfig,
      mockedAccessControlConfig,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    priceOracleAsAlice = PriceOracle__factory.connect(priceOracle.address, alice) as PriceOracle
  })

  describe("#setPrice()", () => {
    context("when price from price feed is 1", () => {
      context("and price with safety margin is 0", () => {
        it("should be success", async () => {
          mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(One), false])
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedCollateralPoolConfig.address)

          mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
            totalDebtShare: 0,
            debtAccumulatedRate: WeiPerRay,
            priceWithSafetyMargin: WeiPerRay,
            debtCeiling: 0,
            debtFloor: 0,
            priceFeed: mockedPriceFeed.address,
            liquidationRatio: WeiPerRay,
            stabilityFeeRate: WeiPerRay,
            lastAccumulationTime: 0,
            adapter: AddressZero,
            closeFactorBps: 5000,
            liquidatorIncentiveBps: 10250,
            treasuryFeesBps: 5000,
            strategy: AddressZero,
          })
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedCollateralPoolConfig.smocked.setPriceWithSafetyMargin.will.return.with()
          await expect(priceOracle.setPrice(formatBytes32String("BNB")))
            .to.emit(priceOracle, "LogSetPrice")
            .withArgs(formatBytes32String("BNB"), formatBytes32BigNumber(One), 0)

          const { calls: peek } = mockedPriceFeed.smocked.peekPrice
          const { calls: setPriceWithSafetyMargin } = mockedCollateralPoolConfig.smocked.setPriceWithSafetyMargin
          expect(peek.length).to.be.equal(1)

          expect(setPriceWithSafetyMargin.length).to.be.equal(1)
          expect(setPriceWithSafetyMargin[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
          expect(setPriceWithSafetyMargin[0]._priceWithSafetyMargin).to.be.equal(BigNumber.from("0"))
        })
      })

      context("and price with safety margin is 10^43", () => {
        it("should be success", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(One), true])

          mockedCollateralPoolConfig.smocked.getLiquidationRatio.will.return.with(10 ** 10)
          mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
            totalDebtShare: 0,
            debtAccumulatedRate: WeiPerRay,
            priceWithSafetyMargin: WeiPerRay,
            debtCeiling: 0,
            debtFloor: 0,
            priceFeed: mockedPriceFeed.address,
            liquidationRatio: 10 ** 10,
            stabilityFeeRate: WeiPerRay,
            lastAccumulationTime: 0,
            adapter: AddressZero,
            closeFactorBps: 5000,
            liquidatorIncentiveBps: 10250,
            treasuryFeesBps: 5000,
            strategy: AddressZero,
          })

          await priceOracle.setStableCoinReferencePrice(10 ** 10)

          mockedCollateralPoolConfig.smocked.setPriceWithSafetyMargin.will.return.with()
          await expect(priceOracle.setPrice(formatBytes32String("BNB")))
            .to.emit(priceOracle, "LogSetPrice")
            .withArgs(formatBytes32String("BNB"), formatBytes32BigNumber(One), BigNumber.from("10").pow("43"))

          const { calls: peek } = mockedPriceFeed.smocked.peekPrice
          const { calls: setPriceWithSafetyMargin } = mockedCollateralPoolConfig.smocked.setPriceWithSafetyMargin
          expect(peek.length).to.be.equal(1)

          expect(setPriceWithSafetyMargin.length).to.be.equal(1)
          expect(setPriceWithSafetyMargin[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
          expect(setPriceWithSafetyMargin[0]._priceWithSafetyMargin).to.be.equal(BigNumber.from("10").pow("43"))
        })
      })

      context("and price with safety margin is 9.31322574615478515625 * 10^53", () => {
        it("should be success", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          mockedCollateralPoolConfig.smocked.getLiquidationRatio.will.return.with(4 ** 10)

          mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(One), true])

          mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
            totalDebtShare: 0,
            debtAccumulatedRate: WeiPerRay,
            priceWithSafetyMargin: WeiPerRay,
            debtCeiling: 0,
            debtFloor: 0,
            priceFeed: mockedPriceFeed.address,
            liquidationRatio: 4 ** 10,
            stabilityFeeRate: WeiPerRay,
            lastAccumulationTime: 0,
            adapter: AddressZero,
            closeFactorBps: 5000,
            liquidatorIncentiveBps: 10250,
            treasuryFeesBps: 5000,
            strategy: AddressZero,
          })

          await priceOracle.setStableCoinReferencePrice(2 ** 10)

          mockedCollateralPoolConfig.smocked.setPriceWithSafetyMargin.will.return.with()
          await expect(priceOracle.setPrice(formatBytes32String("BNB")))
            .to.emit(priceOracle, "LogSetPrice")
            .withArgs(
              formatBytes32String("BNB"),
              formatBytes32BigNumber(One),
              BigNumber.from("931322574615478515625").mul(BigNumber.from("10").pow("33"))
            )

          const { calls: peek } = mockedPriceFeed.smocked.peekPrice
          const { calls: setPriceWithSafetyMargin } = mockedCollateralPoolConfig.smocked.setPriceWithSafetyMargin
          expect(peek.length).to.be.equal(1)

          expect(setPriceWithSafetyMargin.length).to.be.equal(1)
          expect(setPriceWithSafetyMargin[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
          expect(setPriceWithSafetyMargin[0]._priceWithSafetyMargin).to.be.equal(
            BigNumber.from("931322574615478515625").mul(BigNumber.from("10").pow("33"))
          )
        })
      })
    })

    context("when price from price feed is 7 * 10^11", () => {
      context("and price with safety margin is 0", () => {
        it("should be success", async () => {
          mockedPriceFeed.smocked.peekPrice.will.return.with([
            formatBytes32BigNumber(BigNumber.from("700000000000")),
            false,
          ])

          mockedCollateralPoolConfig.smocked.setPriceWithSafetyMargin.will.return.with()
          await expect(priceOracle.setPrice(formatBytes32String("BNB")))
            .to.emit(priceOracle, "LogSetPrice")
            .withArgs(formatBytes32String("BNB"), formatBytes32BigNumber(BigNumber.from("700000000000")), 0)

          const { calls: peek } = mockedPriceFeed.smocked.peekPrice
          const { calls: setPriceWithSafetyMargin } = mockedCollateralPoolConfig.smocked.setPriceWithSafetyMargin
          expect(peek.length).to.be.equal(1)

          expect(setPriceWithSafetyMargin.length).to.be.equal(1)
          expect(setPriceWithSafetyMargin[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
          expect(setPriceWithSafetyMargin[0]._priceWithSafetyMargin).to.be.equal(BigNumber.from("0"))
        })
      })

      context("and price with safety margin is 7 * 10^54", () => {
        it("should be success", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          mockedCollateralPoolConfig.smocked.getLiquidationRatio.will.return.with(10 ** 10)

          mockedPriceFeed.smocked.peekPrice.will.return.with([
            formatBytes32BigNumber(BigNumber.from("700000000000")),
            true,
          ])

          mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
            totalDebtShare: 0,
            debtAccumulatedRate: WeiPerRay,
            priceWithSafetyMargin: WeiPerRay,
            debtCeiling: 0,
            debtFloor: 0,
            priceFeed: mockedPriceFeed.address,
            liquidationRatio: 10 ** 10,
            stabilityFeeRate: WeiPerRay,
            lastAccumulationTime: 0,
            adapter: AddressZero,
            closeFactorBps: 5000,
            liquidatorIncentiveBps: 10250,
            treasuryFeesBps: 5000,
            strategy: AddressZero,
          })

          await priceOracle.setStableCoinReferencePrice(10 ** 10)

          // mockedBookKeeper.smocked.setPriceWithSafetyMargin.will.return.with()
          await expect(priceOracle.setPrice(formatBytes32String("BNB")))
            .to.emit(priceOracle, "LogSetPrice")
            .withArgs(
              formatBytes32String("BNB"),
              formatBytes32BigNumber(BigNumber.from("700000000000")),
              BigNumber.from("7").mul(BigNumber.from("10").pow("54"))
            )

          const { calls: peek } = mockedPriceFeed.smocked.peekPrice
          const { calls: setPriceWithSafetyMargin } = mockedCollateralPoolConfig.smocked.setPriceWithSafetyMargin
          expect(peek.length).to.be.equal(1)

          expect(setPriceWithSafetyMargin.length).to.be.equal(1)
          expect(setPriceWithSafetyMargin[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
          expect(setPriceWithSafetyMargin[0]._priceWithSafetyMargin).to.be.equal(
            BigNumber.from("7").mul(BigNumber.from("10").pow("54"))
          )
        })
      })
    })
  })

  describe("#setStableCoinReferencePrice", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(priceOracleAsAlice.setStableCoinReferencePrice(10 ** 10)).to.be.revertedWith("!ownerRole")
      })
    })
    context("when the caller is the owner", async () => {
      context("when priceOracle does not live", () => {
        it("should be revert", async () => {
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          priceOracle.cage()

          await expect(priceOracle.setStableCoinReferencePrice(10 ** 10)).to.be.revertedWith("PriceOracle/not-live")
        })
      })
      context("when priceOracle is live", () => {
        it("should be able to call setStableCoinReferencePrice", async () => {
          await expect(priceOracle.setStableCoinReferencePrice(10 ** 10))
            .to.emit(priceOracle, "LogSetStableCoinReferencePrice")
            .withArgs(deployerAddress, 10 ** 10)
        })
      })
    })
  })

  describe("#pause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(priceOracleAsAlice.pause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          await priceOracle.pause()
        })
      })
    })

    context("when pause contract", () => {
      it("should be success", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        mockedCollateralPoolConfig.smocked.getLiquidationRatio.will.return.with(10 ** 10)

        mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(One), true])

        await priceOracle.pause()

        mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(One), false])
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: mockedPriceFeed.address,
          liquidationRatio: 10 ** 10,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })

        mockedCollateralPoolConfig.smocked.setPriceWithSafetyMargin.will.return.with()
        await expect(priceOracle.setPrice(formatBytes32String("BNB"))).to.be.revertedWith("Pausable: paused")
      })
    })
  })

  describe("#unpause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(priceOracleAsAlice.unpause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          await priceOracle.pause()
          await priceOracle.unpause()
        })
      })
    })

    context("when unpause contract", () => {
      it("should be success", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        mockedCollateralPoolConfig.smocked.getLiquidationRatio.will.return.with(10 ** 10)

        mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(One), true])

        // pause contract
        await priceOracle.pause()

        // unpause contract
        await priceOracle.unpause()

        mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(One), false])
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: mockedPriceFeed.address,
          liquidationRatio: 10 ** 10,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })

        mockedCollateralPoolConfig.smocked.setPriceWithSafetyMargin.will.return.with()
        await expect(priceOracle.setPrice(formatBytes32String("BNB")))
          .to.emit(priceOracle, "LogSetPrice")
          .withArgs(formatBytes32String("BNB"), formatBytes32BigNumber(One), 0)

        const { calls: peek } = mockedPriceFeed.smocked.peekPrice
        const { calls: setPriceWithSafetyMargin } = mockedCollateralPoolConfig.smocked.setPriceWithSafetyMargin
        expect(peek.length).to.be.equal(1)

        expect(setPriceWithSafetyMargin.length).to.be.equal(1)
        expect(setPriceWithSafetyMargin[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(setPriceWithSafetyMargin[0]._priceWithSafetyMargin).to.be.equal(BigNumber.from("0"))
      })
    })
  })

  describe("#cage()", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(priceOracleAsAlice.cage()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })

    context("when role can access", () => {
      context("caller is owner role ", () => {
        it("should be set live to 0", async () => {
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          expect(await priceOracleAsAlice.live()).to.be.equal(1)

          await expect(priceOracleAsAlice.cage()).to.emit(priceOracleAsAlice, "LogCage").withArgs()

          expect(await priceOracleAsAlice.live()).to.be.equal(0)
        })
      })
    })
  })

  describe("#uncage()", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(priceOracleAsAlice.uncage()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })

    context("when role can access", () => {
      context("caller is owner role ", () => {
        it("should be set live to 1", async () => {
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          expect(await priceOracleAsAlice.live()).to.be.equal(1)

          await priceOracleAsAlice.cage()

          expect(await priceOracleAsAlice.live()).to.be.equal(0)

          await expect(priceOracleAsAlice.uncage()).to.emit(priceOracleAsAlice, "LogUncage").withArgs()

          expect(await priceOracleAsAlice.live()).to.be.equal(1)
        })
      })
    })
  })
})
