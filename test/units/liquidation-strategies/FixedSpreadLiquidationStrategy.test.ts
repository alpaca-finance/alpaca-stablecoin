import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { FixedSpreadLiquidationStrategy, FixedSpreadLiquidationStrategy__factory } from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"

import * as TimeHelpers from "../../helper/time"
import * as AssertHelpers from "../../helper/assert"
import { deploy } from "@openzeppelin/hardhat-upgrades/dist/utils"

import * as UnitHelpers from "../../helper/unit"
import { formatBytes32BigNumber } from "../../helper/format"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { formatBytes32String } = ethers.utils

type fixture = {
  fixedSpreadLiquidationStrategy: FixedSpreadLiquidationStrategy
  mockedBookKeeper: MockContract
  mockedPriceOracle: MockContract
  mockedPriceFeed: MockContract
  mockedLiquidationEngine: MockContract
  mockedSystemDebtEngine: MockContract
  mockedFlashLendingCallee: MockContract
  mockedPositionManager: MockContract
  mockedIbTokenAdapter: MockContract
  mockedCollateralPoolConfig: MockContract
  mockedAccessControlConfig: MockContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  const mockedAccessControlConfig = await smockit(await ethers.getContractFactory("AccessControlConfig", deployer))

  const mockedCollateralPoolConfig = await smockit(await ethers.getContractFactory("CollateralPoolConfig", deployer))

  // Deploy mocked BookKeeper
  const mockedBookKeeper = await smockit(await ethers.getContractFactory("BookKeeper", deployer))

  // Deploy mocked PriceOracle
  const mockedPriceOracle = await smockit(await ethers.getContractFactory("PriceOracle", deployer))

  // Deploy mocked PriceFeed
  const mockedPriceFeed = await smockit(await ethers.getContractFactory("MockPriceFeed", deployer))

  // Deploy mocked LiquidationEngine
  const mockedLiquidationEngine = await smockit(await ethers.getContractFactory("LiquidationEngine", deployer))

  // Deploy mocked SystemDebtEngine
  const mockedSystemDebtEngine = await smockit(await ethers.getContractFactory("SystemDebtEngine", deployer))

  // Deploy mocked FlashLendingCallee
  const mockedFlashLendingCallee = await smockit(await ethers.getContractFactory("MockFlashLendingCallee", deployer))

  // Deploy mocked PositionManager
  const mockedPositionManager = await smockit(await ethers.getContractFactory("PositionManager", deployer))

  // Deploy mocked IbTokenAdapter
  const mockedIbTokenAdapter = await smockit(await ethers.getContractFactory("IbTokenAdapter", deployer))

  const FixedSpreadLiquidationStrategy = (await ethers.getContractFactory(
    "FixedSpreadLiquidationStrategy",
    deployer
  )) as FixedSpreadLiquidationStrategy__factory
  const fixedSpreadLiquidationStrategy = (await upgrades.deployProxy(FixedSpreadLiquidationStrategy, [
    mockedBookKeeper.address,
    mockedPriceOracle.address,
    mockedLiquidationEngine.address,
    mockedSystemDebtEngine.address,
    mockedPositionManager.address,
  ])) as FixedSpreadLiquidationStrategy

  return {
    fixedSpreadLiquidationStrategy,
    mockedBookKeeper,
    mockedPriceOracle,
    mockedPriceFeed,
    mockedLiquidationEngine,
    mockedSystemDebtEngine,
    mockedFlashLendingCallee,
    mockedPositionManager,
    mockedIbTokenAdapter,
    mockedAccessControlConfig,
    mockedCollateralPoolConfig,
  }
}

describe("FixedSpreadLiquidationStrategy", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string

  // Contracts
  let mockedBookKeeper: MockContract
  let mockedPriceOracle: MockContract
  let mockedPriceFeed: MockContract
  let mockedLiquidationEngine: MockContract
  let mockedSystemDebtEngine: MockContract
  let mockedFlashLendingCallee: MockContract
  let mockedPositionManager: MockContract
  let mockedIbTokenAdapter: MockContract
  let mockedCollateralPoolConfig: MockContract
  let mockedAccessControlConfig: MockContract

  let fixedSpreadLiquidationStrategy: FixedSpreadLiquidationStrategy
  let fixedSpreadLiquidationStrategyAsAlice: FixedSpreadLiquidationStrategy

  beforeEach(async () => {
    ;({
      fixedSpreadLiquidationStrategy,
      mockedBookKeeper,
      mockedPriceOracle,
      mockedPriceFeed,
      mockedLiquidationEngine,
      mockedSystemDebtEngine,
      mockedFlashLendingCallee,
      mockedPositionManager,
      mockedIbTokenAdapter,
      mockedCollateralPoolConfig,
      mockedAccessControlConfig,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    fixedSpreadLiquidationStrategyAsAlice = FixedSpreadLiquidationStrategy__factory.connect(
      fixedSpreadLiquidationStrategy.address,
      alice
    ) as FixedSpreadLiquidationStrategy
  })

  describe("#execute", () => {
    context("when the caller is not allowed", () => {
      it("should be revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(false)

        await expect(
          fixedSpreadLiquidationStrategyAsAlice.execute(
            formatBytes32String("BNB"),
            UnitHelpers.WeiPerRad,
            UnitHelpers.WeiPerWad,
            aliceAddress,
            UnitHelpers.WeiPerWad,
            UnitHelpers.WeiPerWad,
            deployerAddress,
            deployerAddress,
            "0x"
          )
        ).to.be.revertedWith("!liquidationEngingRole")
      })
    })
    context("when input is invalid", () => {
      context("when positionDebtShare <= 0", () => {
        it("should be revert", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          await expect(
            fixedSpreadLiquidationStrategy.execute(
              formatBytes32String("BNB"),
              0,
              UnitHelpers.WeiPerWad,
              aliceAddress,
              UnitHelpers.WeiPerWad,
              UnitHelpers.WeiPerWad,
              deployerAddress,
              deployerAddress,
              "0x"
            )
          ).to.be.revertedWith("FixedSpreadLiquidationStrategy/zero-debt")
        })
      })

      context("when positionCollateralAmount <= 0", () => {
        it("should be revert", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          await expect(
            fixedSpreadLiquidationStrategy.execute(
              formatBytes32String("BNB"),
              UnitHelpers.WeiPerWad,
              0,
              aliceAddress,
              UnitHelpers.WeiPerWad,
              UnitHelpers.WeiPerWad,
              deployerAddress,
              deployerAddress,
              "0x"
            )
          ).to.be.revertedWith("FixedSpreadLiquidationStrategy/zero-collateral-amount")
        })
      })

      context("when positionAddress == 0", () => {
        it("should be revert", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          await expect(
            fixedSpreadLiquidationStrategy.execute(
              formatBytes32String("BNB"),
              UnitHelpers.WeiPerWad,
              UnitHelpers.WeiPerWad,
              AddressZero,
              UnitHelpers.WeiPerWad,
              UnitHelpers.WeiPerWad,
              deployerAddress,
              deployerAddress,
              ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [deployerAddress, []])
            )
          ).to.be.revertedWith("FixedSpreadLiquidationStrategy/zero-position-address")
        })
      })
    })

    context("when feedprice is invalid", () => {
      context("when priceFeed marked price as not ok", () => {
        it("should be revert", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          mockedCollateralPoolConfig.smocked.getPriceFeed.will.return.with(mockedPriceFeed.address)

          mockedPriceFeed.smocked.peekPrice.will.return.with([
            formatBytes32BigNumber(BigNumber.from("700000000000")),
            false,
          ])

          await expect(
            fixedSpreadLiquidationStrategy.execute(
              formatBytes32String("BNB"),
              UnitHelpers.WeiPerRad,
              UnitHelpers.WeiPerWad,
              aliceAddress,
              UnitHelpers.WeiPerWad,
              UnitHelpers.WeiPerWad,
              deployerAddress,
              deployerAddress,
              "0x"
            )
          ).to.be.revertedWith("FixedSpreadLiquidationStrategy/invalid-price")
        })
      })
      context("feedprice <= 0", () => {
        it("should be revert", async () => {
          mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
          mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
          mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

          mockedCollateralPoolConfig.smocked.getPriceFeed.will.return.with(mockedPriceFeed.address)

          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(UnitHelpers.WeiPerRay)
          mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(BigNumber.from("0")), true])

          await expect(
            fixedSpreadLiquidationStrategy.execute(
              formatBytes32String("BNB"),
              UnitHelpers.WeiPerRad,
              UnitHelpers.WeiPerWad,
              aliceAddress,
              UnitHelpers.WeiPerWad,
              UnitHelpers.WeiPerWad,
              deployerAddress,
              deployerAddress,
              "0x"
            )
          ).to.be.revertedWith("FixedSpreadLiquidationStrategy/zero-collateral-price")
        })
      })
    })

    context("when contract doesn't call FlashLending", () => {
      context("when feedprice == 1", () => {
        context("and debtAccumulatedRate == 2", () => {
          it("should be success", async () => {
            mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
            mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
            mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

            mockedCollateralPoolConfig.smocked.getPriceFeed.will.return.with(mockedPriceFeed.address)
            mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(UnitHelpers.WeiPerRay.mul(2))
            mockedCollateralPoolConfig.smocked.getPriceWithSafetyMargin.will.return.with(UnitHelpers.WeiPerRay)
            mockedCollateralPoolConfig.smocked.getLiquidationRatio.will.return.with(10 ** 10)
            mockedCollateralPoolConfig.smocked.getCloseFactorBps.will.return.with(10000)
            mockedCollateralPoolConfig.smocked.getLiquidatorIncentiveBps.will.return.with(10250)
            mockedCollateralPoolConfig.smocked.getTreasuryFeesBps.will.return.with(2500)
            mockedCollateralPoolConfig.smocked.getAdapter.will.return.with(mockedIbTokenAdapter.address)

            mockedIbTokenAdapter.smocked.onMoveCollateral.will.return.with()

            mockedBookKeeper.smocked.confiscatePosition.will.return.with()
            mockedBookKeeper.smocked.moveCollateral.will.return.with()
            mockedBookKeeper.smocked.moveStablecoin.will.return.with()
            mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(UnitHelpers.WeiPerRay)
            mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(UnitHelpers.WeiPerWad), true])

            await expect(
              fixedSpreadLiquidationStrategy.execute(
                formatBytes32String("BNB"),
                UnitHelpers.WeiPerWad,
                UnitHelpers.WeiPerWad.mul(7),
                aliceAddress,
                UnitHelpers.WeiPerWad,
                UnitHelpers.WeiPerWad,
                deployerAddress,
                deployerAddress,
                "0x"
              )
            )
              .to.emit(fixedSpreadLiquidationStrategy, "LogFixedSpreadLiquidate")
              .withArgs(
                formatBytes32String("BNB"),
                UnitHelpers.WeiPerWad,
                UnitHelpers.WeiPerWad.mul(7),
                aliceAddress,
                UnitHelpers.WeiPerWad,
                UnitHelpers.WeiPerWad,
                deployerAddress,
                deployerAddress,
                UnitHelpers.WeiPerWad,
                UnitHelpers.WeiPerRad.mul(2),
                ethers.utils.parseEther("2.05"),
                ethers.utils.parseEther("0.0125")
              )

            const { calls: confiscatePosition } = mockedBookKeeper.smocked.confiscatePosition
            expect(confiscatePosition.length).to.be.equal(1)
            expect(confiscatePosition[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(confiscatePosition[0]._positionAddress).to.be.equal(aliceAddress)
            expect(confiscatePosition[0]._collateralCreditor).to.be.equal(fixedSpreadLiquidationStrategy.address)
            expect(confiscatePosition[0]._stablecoinDebtor).to.be.equal(mockedSystemDebtEngine.address)
            expect(confiscatePosition[0]._collateralAmount).to.be.equal(ethers.utils.parseEther("2.05").mul(-1))
            expect(confiscatePosition[0]._debtShare).to.be.equal(UnitHelpers.WeiPerWad.mul(-1))

            const { calls: moveCollateral } = mockedBookKeeper.smocked.moveCollateral
            expect(moveCollateral.length).to.be.equal(2)
            //Give the collateral to the collateralRecipient
            expect(moveCollateral[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(moveCollateral[0]._src).to.be.equal(fixedSpreadLiquidationStrategy.address)
            expect(moveCollateral[0]._dst).to.be.equal(deployerAddress)
            expect(moveCollateral[0]._amount).to.be.equal(ethers.utils.parseEther("2.0375"))
            //Give the treasury fees to System Debt Engine to be stored as system surplus
            expect(moveCollateral[1]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(moveCollateral[1]._src).to.be.equal(fixedSpreadLiquidationStrategy.address)
            expect(moveCollateral[1]._dst).to.be.equal(mockedSystemDebtEngine.address)
            expect(moveCollateral[1]._amount).to.be.equal(ethers.utils.parseEther("0.0125"))

            const { calls: stableCoinReferencePrice } = mockedPriceOracle.smocked.stableCoinReferencePrice
            expect(stableCoinReferencePrice.length).to.be.equal(1)

            const { calls: peekPrice } = mockedPriceFeed.smocked.peekPrice
            expect(peekPrice.length).to.be.equal(1)
          })
        })

        context("and debtAccumulatedRate == 12345", () => {
          it("should be success", async () => {
            mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
            mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
            mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

            mockedCollateralPoolConfig.smocked.getPriceFeed.will.return.with(mockedPriceFeed.address)
            mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(UnitHelpers.WeiPerRay.mul(12345))
            mockedCollateralPoolConfig.smocked.getPriceWithSafetyMargin.will.return.with(UnitHelpers.WeiPerRay)
            mockedCollateralPoolConfig.smocked.getLiquidationRatio.will.return.with(10 ** 10)
            mockedCollateralPoolConfig.smocked.getCloseFactorBps.will.return.with(5000)
            mockedCollateralPoolConfig.smocked.getLiquidatorIncentiveBps.will.return.with(10300)
            mockedCollateralPoolConfig.smocked.getTreasuryFeesBps.will.return.with(700)
            mockedCollateralPoolConfig.smocked.getAdapter.will.return.with(mockedIbTokenAdapter.address)

            mockedIbTokenAdapter.smocked.onMoveCollateral.will.return.with()

            mockedBookKeeper.smocked.confiscatePosition.will.return.with()
            mockedBookKeeper.smocked.moveCollateral.will.return.with()
            mockedBookKeeper.smocked.moveStablecoin.will.return.with()
            mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(UnitHelpers.WeiPerRay)
            mockedPriceFeed.smocked.peekPrice.will.return.with([
              formatBytes32BigNumber(UnitHelpers.WeiPerWad.mul(2)),
              true,
            ])

            await fixedSpreadLiquidationStrategy.execute(
              formatBytes32String("BNB"),
              UnitHelpers.WeiPerWad,
              UnitHelpers.WeiPerWad.mul(98765),
              aliceAddress,
              UnitHelpers.WeiPerWad.div(4),
              UnitHelpers.WeiPerWad.div(4),
              deployerAddress,
              deployerAddress,
              "0x"
            )

            const { calls: confiscatePosition } = mockedBookKeeper.smocked.confiscatePosition
            expect(confiscatePosition.length).to.be.equal(1)
            expect(confiscatePosition[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(confiscatePosition[0]._positionAddress).to.be.equal(aliceAddress)
            expect(confiscatePosition[0]._collateralCreditor).to.be.equal(fixedSpreadLiquidationStrategy.address)
            expect(confiscatePosition[0]._stablecoinDebtor).to.be.equal(mockedSystemDebtEngine.address)
            expect(confiscatePosition[0]._collateralAmount).to.be.equal(
              UnitHelpers.WeiPerWad.mul(-158941875).div(100000)
            )
            expect(confiscatePosition[0]._debtShare).to.be.equal(UnitHelpers.WeiPerWad.mul(-25).div(100))

            const { calls: moveCollateral } = mockedBookKeeper.smocked.moveCollateral
            expect(moveCollateral.length).to.be.equal(2)
            //Give the collateral to the collateralRecipient
            expect(moveCollateral[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(moveCollateral[0]._src).to.be.equal(fixedSpreadLiquidationStrategy.address)
            expect(moveCollateral[0]._dst).to.be.equal(deployerAddress)
            expect(moveCollateral[0]._amount).to.be.equal(ethers.utils.parseEther("1586.1781875"))
            //Give the treasury fees to System Debt Engine to be stored as system surplus
            expect(moveCollateral[1]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(moveCollateral[1]._src).to.be.equal(fixedSpreadLiquidationStrategy.address)
            expect(moveCollateral[1]._dst).to.be.equal(mockedSystemDebtEngine.address)
            expect(moveCollateral[1]._amount).to.be.equal(ethers.utils.parseEther("3.2405625"))

            const { calls: stableCoinReferencePrice } = mockedPriceOracle.smocked.stableCoinReferencePrice
            expect(stableCoinReferencePrice.length).to.be.equal(1)

            const { calls: peekPrice } = mockedPriceFeed.smocked.peekPrice
            expect(peekPrice.length).to.be.equal(1)

            const { calls: flashLendingCall } = mockedFlashLendingCallee.smocked.flashLendingCall
            expect(flashLendingCall.length).to.be.equal(0)
          })
        })
      })
    })

    context("when contract call FlashLending", () => {
      it("should be success", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedBookKeeper.smocked.accessControlConfig.will.return.with(mockedAccessControlConfig.address)
        mockedAccessControlConfig.smocked.hasRole.will.return.with(true)

        mockedCollateralPoolConfig.smocked.getPriceFeed.will.return.with(mockedPriceFeed.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(UnitHelpers.WeiPerRay.mul(3))
        mockedCollateralPoolConfig.smocked.getPriceWithSafetyMargin.will.return.with(UnitHelpers.WeiPerRay)
        mockedCollateralPoolConfig.smocked.getLiquidationRatio.will.return.with(10 ** 10)
        mockedCollateralPoolConfig.smocked.getCloseFactorBps.will.return.with(5000)
        mockedCollateralPoolConfig.smocked.getLiquidatorIncentiveBps.will.return.with(10001)
        mockedCollateralPoolConfig.smocked.getTreasuryFeesBps.will.return.with(17)
        mockedCollateralPoolConfig.smocked.getAdapter.will.return.with(mockedIbTokenAdapter.address)

        mockedIbTokenAdapter.smocked.onMoveCollateral.will.return.with()

        mockedBookKeeper.smocked.confiscatePosition.will.return.with()
        mockedBookKeeper.smocked.moveCollateral.will.return.with()
        mockedBookKeeper.smocked.moveStablecoin.will.return.with()
        mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(UnitHelpers.WeiPerRay)
        mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(UnitHelpers.WeiPerWad), true])
        mockedFlashLendingCallee.smocked.flashLendingCall.will.return.with()

        await fixedSpreadLiquidationStrategy.setFlashLendingEnabled(1)

        await expect(
          fixedSpreadLiquidationStrategy.execute(
            formatBytes32String("BNB"),
            UnitHelpers.WeiPerWad,
            UnitHelpers.WeiPerWad.mul(8),
            aliceAddress,
            UnitHelpers.WeiPerWad.mul(37).div(100),
            UnitHelpers.WeiPerWad.mul(37).div(100),
            deployerAddress,
            mockedFlashLendingCallee.address,
            ethers.utils.defaultAbiCoder.encode(
              ["bytes"],
              [ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])]
            )
          )
        )
          .to.emit(fixedSpreadLiquidationStrategy, "LogFixedSpreadLiquidate")
          .withArgs(
            formatBytes32String("BNB"),
            UnitHelpers.WeiPerWad,
            UnitHelpers.WeiPerWad.mul(8),
            aliceAddress,
            UnitHelpers.WeiPerWad.mul(37).div(100),
            UnitHelpers.WeiPerWad.mul(37).div(100),
            deployerAddress,
            mockedFlashLendingCallee.address,
            UnitHelpers.WeiPerWad.mul(37).div(100),
            ethers.utils.parseEther("1.11").mul(UnitHelpers.WeiPerRay),
            ethers.utils.parseEther("1.110111"),
            ethers.utils.parseEther("0.0000001887")
          )

        const { calls: confiscatePosition } = mockedBookKeeper.smocked.confiscatePosition
        expect(confiscatePosition.length).to.be.equal(1)
        expect(confiscatePosition[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(confiscatePosition[0]._positionAddress).to.be.equal(aliceAddress)
        expect(confiscatePosition[0]._collateralCreditor).to.be.equal(fixedSpreadLiquidationStrategy.address)
        expect(confiscatePosition[0]._stablecoinDebtor).to.be.equal(mockedSystemDebtEngine.address)
        expect(confiscatePosition[0]._collateralAmount).to.be.equal(UnitHelpers.WeiPerWad.mul(-1110111).div(1000000))
        expect(confiscatePosition[0]._debtShare).to.be.equal(UnitHelpers.WeiPerWad.mul(-37).div(100))

        const { calls: moveCollateral } = mockedBookKeeper.smocked.moveCollateral
        expect(moveCollateral.length).to.be.equal(2)
        //Give the collateral to the collateralRecipient
        expect(moveCollateral[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(moveCollateral[0]._src).to.be.equal(fixedSpreadLiquidationStrategy.address)
        expect(moveCollateral[0]._dst).to.be.equal(mockedFlashLendingCallee.address)
        expect(moveCollateral[0]._amount).to.be.equal(ethers.utils.parseEther("1.1101108113"))
        //Give the treasury fees to System Debt Engine to be stored as system surplus
        expect(moveCollateral[1]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(moveCollateral[1]._src).to.be.equal(fixedSpreadLiquidationStrategy.address)
        expect(moveCollateral[1]._dst).to.be.equal(mockedSystemDebtEngine.address)
        expect(moveCollateral[1]._amount).to.be.equal(ethers.utils.parseEther("0.0000001887"))

        const { calls: stableCoinReferencePrice } = mockedPriceOracle.smocked.stableCoinReferencePrice
        expect(stableCoinReferencePrice.length).to.be.equal(1)

        const { calls: peekPrice } = mockedPriceFeed.smocked.peekPrice
        expect(peekPrice.length).to.be.equal(1)

        const { calls: flashLendingCall } = mockedFlashLendingCallee.smocked.flashLendingCall
        expect(flashLendingCall.length).to.be.equal(1)
      })
    })
  })
})
