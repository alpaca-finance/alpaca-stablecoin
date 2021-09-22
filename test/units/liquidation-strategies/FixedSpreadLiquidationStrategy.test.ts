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
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

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

  const FixedSpreadLiquidationStrategy = (await ethers.getContractFactory(
    "FixedSpreadLiquidationStrategy",
    deployer
  )) as FixedSpreadLiquidationStrategy__factory
  const fixedSpreadLiquidationStrategy = (await upgrades.deployProxy(FixedSpreadLiquidationStrategy, [
    mockedBookKeeper.address,
    mockedPriceOracle.address,
    mockedLiquidationEngine.address,
    mockedSystemDebtEngine.address,
  ])) as FixedSpreadLiquidationStrategy

  return {
    fixedSpreadLiquidationStrategy,
    mockedBookKeeper,
    mockedPriceOracle,
    mockedPriceFeed,
    mockedLiquidationEngine,
    mockedSystemDebtEngine,
    mockedFlashLendingCallee,
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
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    fixedSpreadLiquidationStrategyAsAlice = FixedSpreadLiquidationStrategy__factory.connect(
      fixedSpreadLiquidationStrategy.address,
      alice
    ) as FixedSpreadLiquidationStrategy
  })

  describe("#setCloseFactorBps", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(
          fixedSpreadLiquidationStrategyAsAlice.setCloseFactorBps(formatBytes32String("BNB"), 10)
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when parameters are valid", () => {
      it("should be able to call setCloseFactorBps", async () => {
        // grant role access
        await fixedSpreadLiquidationStrategy.grantRole(
          await fixedSpreadLiquidationStrategy.OWNER_ROLE(),
          deployerAddress
        )

        // set Strategy
        await expect(fixedSpreadLiquidationStrategy.setCloseFactorBps(formatBytes32String("BNB"), 10))
          .to.emit(fixedSpreadLiquidationStrategy, "SetCloseFactorBps")
          .withArgs(deployerAddress, formatBytes32String("BNB"), 10)
      })
    })
  })

  describe("#setLiquidatorIncentiveBps", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(
          fixedSpreadLiquidationStrategyAsAlice.setLiquidatorIncentiveBps(formatBytes32String("BNB"), 10)
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when parameters are valid", () => {
      it("should be able to call setLiquidatorIncentiveBps", async () => {
        // grant role access
        await fixedSpreadLiquidationStrategy.grantRole(
          await fixedSpreadLiquidationStrategy.OWNER_ROLE(),
          deployerAddress
        )

        // set Strategy
        await expect(fixedSpreadLiquidationStrategy.setLiquidatorIncentiveBps(formatBytes32String("BNB"), 10))
          .to.emit(fixedSpreadLiquidationStrategy, "SetLiquidatorIncentiveBps")
          .withArgs(deployerAddress, formatBytes32String("BNB"), 10)
      })
    })
  })

  describe("#setTreasuryFeesBps", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(
          fixedSpreadLiquidationStrategyAsAlice.setTreasuryFeesBps(formatBytes32String("BNB"), 10)
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when parameters are valid", () => {
      it("should be able to call setTreasuryFeesBps", async () => {
        // grant role access
        await fixedSpreadLiquidationStrategy.grantRole(
          await fixedSpreadLiquidationStrategy.OWNER_ROLE(),
          deployerAddress
        )

        // set Strategy
        await expect(fixedSpreadLiquidationStrategy.setTreasuryFeesBps(formatBytes32String("BNB"), 10))
          .to.emit(fixedSpreadLiquidationStrategy, "SetTreasuryFeesBps")
          .withArgs(deployerAddress, formatBytes32String("BNB"), 10)
      })
    })
  })

  describe("#execute", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(
          fixedSpreadLiquidationStrategyAsAlice.execute(
            formatBytes32String("BNB"),
            UnitHelpers.WeiPerRad,
            UnitHelpers.WeiPerWad,
            aliceAddress,
            UnitHelpers.WeiPerWad,
            ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [deployerAddress, []])
          )
        ).to.be.revertedWith("!liquidationEngingRole")
      })
    })
    context("when input is invalid", () => {
      context("when positionDebtShare <= 0", () => {
        it("should be revert", async () => {
          await fixedSpreadLiquidationStrategy.grantRole(
            await fixedSpreadLiquidationStrategy.LIQUIDATION_ENGINE_ROLE(),
            deployerAddress
          )

          await expect(
            fixedSpreadLiquidationStrategy.execute(
              formatBytes32String("BNB"),
              0,
              UnitHelpers.WeiPerWad,
              aliceAddress,
              UnitHelpers.WeiPerWad,
              ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [deployerAddress, []])
            )
          ).to.be.revertedWith("FixedSpreadLiquidationStrategy/zero-debt")
        })
      })

      context("when positionCollateralAmount <= 0", () => {
        it("should be revert", async () => {
          await fixedSpreadLiquidationStrategy.grantRole(
            await fixedSpreadLiquidationStrategy.LIQUIDATION_ENGINE_ROLE(),
            deployerAddress
          )

          await expect(
            fixedSpreadLiquidationStrategy.execute(
              formatBytes32String("BNB"),
              UnitHelpers.WeiPerWad,
              0,
              aliceAddress,
              UnitHelpers.WeiPerWad,
              ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [deployerAddress, []])
            )
          ).to.be.revertedWith("FixedSpreadLiquidationStrategy/zero-collateralAmount")
        })
      })

      context("when positionAddress == 0", () => {
        it("should be revert", async () => {
          await fixedSpreadLiquidationStrategy.grantRole(
            await fixedSpreadLiquidationStrategy.LIQUIDATION_ENGINE_ROLE(),
            deployerAddress
          )

          await expect(
            fixedSpreadLiquidationStrategy.execute(
              formatBytes32String("BNB"),
              UnitHelpers.WeiPerWad,
              UnitHelpers.WeiPerWad,
              AddressZero,
              UnitHelpers.WeiPerWad,
              ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [deployerAddress, []])
            )
          ).to.be.revertedWith("FixedSpreadLiquidationStrategy/zero-positionAddress")
        })
      })
    })
    context("when close factor is invalid", () => {
      context("closeFactorBps is 0", () => {
        it("should be revert", async () => {
          await fixedSpreadLiquidationStrategy.grantRole(
            await fixedSpreadLiquidationStrategy.LIQUIDATION_ENGINE_ROLE(),
            deployerAddress
          )
          // mock contract
          mockedBookKeeper.smocked.collateralPools.will.return.with([
            BigNumber.from(0),
            UnitHelpers.WeiPerRay.mul(2),
            UnitHelpers.WeiPerRay,
            BigNumber.from(0),
            BigNumber.from(0),
          ])

          await expect(
            fixedSpreadLiquidationStrategy.execute(
              formatBytes32String("BNB"),
              UnitHelpers.WeiPerRad,
              UnitHelpers.WeiPerWad,
              aliceAddress,
              UnitHelpers.WeiPerWad,
              ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [deployerAddress, []])
            )
          ).to.be.revertedWith("FixedSpreadLiquidationStrategy/close-factor-exceeded")
        })
      })

      context("debtShareToRepay > closeFactor (overpay debtShare)", () => {
        it("should be revert", async () => {
          await fixedSpreadLiquidationStrategy.grantRole(
            await fixedSpreadLiquidationStrategy.LIQUIDATION_ENGINE_ROLE(),
            deployerAddress
          )
          // mock contract
          mockedBookKeeper.smocked.collateralPools.will.return.with([
            BigNumber.from(0),
            UnitHelpers.WeiPerRay.mul(2),
            UnitHelpers.WeiPerRay,
            BigNumber.from(0),
            BigNumber.from(0),
          ])
          mockedBookKeeper.smocked.confiscatePosition.will.return.with()
          mockedBookKeeper.smocked.moveCollateral.will.return.with()
          mockedBookKeeper.smocked.moveStablecoin.will.return.with()
          mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, 0])
          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with([10 ^ 9])
          mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(BigNumber.from("1")), true])

          await fixedSpreadLiquidationStrategy.setCloseFactorBps(formatBytes32String("BNB"), 1)
          await fixedSpreadLiquidationStrategy.setLiquidatorIncentiveBps(formatBytes32String("BNB"), 1)
          await fixedSpreadLiquidationStrategy.setTreasuryFeesBps(formatBytes32String("BNB"), 1)

          await expect(
            fixedSpreadLiquidationStrategy.execute(
              formatBytes32String("BNB"),
              UnitHelpers.WeiPerWad,
              UnitHelpers.WeiPerRad.mul(5),
              aliceAddress,
              UnitHelpers.WeiPerRad,
              ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [deployerAddress, []])
            )
          ).to.be.revertedWith("FixedSpreadLiquidationStrategy/close-factor-exceeded")
        })
      })
    })

    context("when feedprice is invalid", () => {
      context("when priceFeed marked price as not ok", () => {
        it("should be revert", async () => {
          await fixedSpreadLiquidationStrategy.grantRole(
            await fixedSpreadLiquidationStrategy.LIQUIDATION_ENGINE_ROLE(),
            deployerAddress
          )
          // mock contract
          mockedBookKeeper.smocked.collateralPools.will.return.with([
            BigNumber.from(0),
            UnitHelpers.WeiPerRay.mul(2),
            UnitHelpers.WeiPerRay,
            BigNumber.from(0),
            BigNumber.from(0),
          ])
          mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, 0])
          mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(BigNumber.from("700000000000")), false])

          await fixedSpreadLiquidationStrategy.setCloseFactorBps(formatBytes32String("BNB"), 10)

          await expect(
            fixedSpreadLiquidationStrategy.execute(
              formatBytes32String("BNB"),
              UnitHelpers.WeiPerRad,
              UnitHelpers.WeiPerWad,
              aliceAddress,
              UnitHelpers.WeiPerWad,
              ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [deployerAddress, []])
            )
          ).to.be.revertedWith("FixedSpreadLiquidationStrategy/invalid-price")
        })
      })
      context("feedprice <= 0", () => {
        it("should be revert", async () => {
          await fixedSpreadLiquidationStrategy.grantRole(
            await fixedSpreadLiquidationStrategy.LIQUIDATION_ENGINE_ROLE(),
            deployerAddress
          )
          // mock contract
          mockedBookKeeper.smocked.collateralPools.will.return.with([
            BigNumber.from(0),
            UnitHelpers.WeiPerRay.mul(2),
            UnitHelpers.WeiPerRay,
            BigNumber.from(0),
            BigNumber.from(0),
          ])
          mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, 0])
          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with([10])
          mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(BigNumber.from("0")), true])

          await fixedSpreadLiquidationStrategy.setCloseFactorBps(formatBytes32String("BNB"), 10)

          await expect(
            fixedSpreadLiquidationStrategy.execute(
              formatBytes32String("BNB"),
              UnitHelpers.WeiPerRad,
              UnitHelpers.WeiPerWad,
              aliceAddress,
              UnitHelpers.WeiPerWad,
              ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [deployerAddress, []])
            )
          ).to.be.revertedWith("FixedSpreadLiquidationStrategy/zero-starting-price")
        })
      })
    })

    context("when liquidate amount > collateral amount (overliquidate)", () => {
      it("should be revert", async () => {
        await fixedSpreadLiquidationStrategy.grantRole(
          await fixedSpreadLiquidationStrategy.LIQUIDATION_ENGINE_ROLE(),
          deployerAddress
        )
        // mock contract
        mockedBookKeeper.smocked.collateralPools.will.return.with([
          BigNumber.from(0),
          UnitHelpers.WeiPerRay.mul(2),
          UnitHelpers.WeiPerRay,
          BigNumber.from(0),
          BigNumber.from(0),
        ])
        mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, 0])
        mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(UnitHelpers.WeiPerRay)
        mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(UnitHelpers.WeiPerWad), true])

        await fixedSpreadLiquidationStrategy.setCloseFactorBps(formatBytes32String("BNB"), 250)
        await fixedSpreadLiquidationStrategy.setLiquidatorIncentiveBps(formatBytes32String("BNB"), 250)
        await fixedSpreadLiquidationStrategy.setTreasuryFeesBps(formatBytes32String("BNB"), 250)

        await expect(
          fixedSpreadLiquidationStrategy.execute(
            formatBytes32String("BNB"),
            UnitHelpers.WeiPerRad,
            UnitHelpers.WeiPerWad,
            aliceAddress,
            UnitHelpers.WeiPerWad,
            ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [deployerAddress, []])
          )
        ).to.be.revertedWith("FixedSpreadLiquidationStrategy/liquidate-too-much")
      })
    })

    context("when contract doesn't call FlashLending", () => {
      context("when feedprice == 1", () => {
        context("and debtAccumulatedRate == 2", () => {
          it("should be success", async () => {
            await fixedSpreadLiquidationStrategy.grantRole(
              await fixedSpreadLiquidationStrategy.LIQUIDATION_ENGINE_ROLE(),
              deployerAddress
            )
            // mock contract
            mockedBookKeeper.smocked.collateralPools.will.return.with([
              BigNumber.from(0),
              UnitHelpers.WeiPerRay.mul(2),
              UnitHelpers.WeiPerRay,
              BigNumber.from(0),
              BigNumber.from(0),
            ])
            mockedBookKeeper.smocked.confiscatePosition.will.return.with()
            mockedBookKeeper.smocked.moveCollateral.will.return.with()
            mockedBookKeeper.smocked.moveStablecoin.will.return.with()
            mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, 0])
            mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(UnitHelpers.WeiPerRay)
            mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(UnitHelpers.WeiPerWad), true])

            await fixedSpreadLiquidationStrategy.setCloseFactorBps(formatBytes32String("BNB"), 10000)
            await fixedSpreadLiquidationStrategy.setLiquidatorIncentiveBps(formatBytes32String("BNB"), 10000)
            await fixedSpreadLiquidationStrategy.setTreasuryFeesBps(formatBytes32String("BNB"), 10000)

            await expect(
              fixedSpreadLiquidationStrategy.execute(
                formatBytes32String("BNB"),
                UnitHelpers.WeiPerWad,
                UnitHelpers.WeiPerWad.mul(7),
                aliceAddress,
                UnitHelpers.WeiPerWad,
                ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [deployerAddress, []])
              )
            )
              .to.emit(fixedSpreadLiquidationStrategy, "FixedSpreadLiquidate")
              .withArgs(
                formatBytes32String("BNB"),
                UnitHelpers.WeiPerRad.mul(2),
                UnitHelpers.WeiPerWad.mul(2),
                UnitHelpers.WeiPerWad.mul(2),
                UnitHelpers.WeiPerWad.mul(2),
                aliceAddress,
                deployerAddress
              )

            const { calls: BookkeeperCollateralPools } = mockedBookKeeper.smocked.collateralPools
            expect(BookkeeperCollateralPools.length).to.be.equal(1)
            expect(BookkeeperCollateralPools[0][0]).to.be.equal(formatBytes32String("BNB"))

            const { calls: confiscatePosition } = mockedBookKeeper.smocked.confiscatePosition
            expect(confiscatePosition.length).to.be.equal(1)
            expect(confiscatePosition[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(confiscatePosition[0].positionAddress).to.be.equal(aliceAddress)
            expect(confiscatePosition[0].collateralCreditor).to.be.equal(fixedSpreadLiquidationStrategy.address)
            expect(confiscatePosition[0].stablecoinDebtor).to.be.equal(mockedSystemDebtEngine.address)
            expect(confiscatePosition[0].collateralValue).to.be.equal(UnitHelpers.WeiPerWad.mul(-6))
            expect(confiscatePosition[0].debtShare).to.be.equal(UnitHelpers.WeiPerWad.mul(-1))

            const { calls: moveCollateral } = mockedBookKeeper.smocked.moveCollateral
            expect(moveCollateral.length).to.be.equal(2)
            //Give the collateral to the collateralRecipient
            expect(moveCollateral[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(moveCollateral[0].src).to.be.equal(fixedSpreadLiquidationStrategy.address)
            expect(moveCollateral[0].dst).to.be.equal(deployerAddress)
            expect(moveCollateral[0].wad).to.be.equal(UnitHelpers.WeiPerWad.mul(4))
            //Give the treasury fees to System Debt Engine to be stored as system surplus
            expect(moveCollateral[1].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(moveCollateral[1].src).to.be.equal(fixedSpreadLiquidationStrategy.address)
            expect(moveCollateral[1].dst).to.be.equal(mockedSystemDebtEngine.address)
            expect(moveCollateral[1].wad).to.be.equal(UnitHelpers.WeiPerWad.mul(2))

            const { calls: PriceOracleCollateralPools } = mockedPriceOracle.smocked.collateralPools
            expect(PriceOracleCollateralPools.length).to.be.equal(1)
            expect(PriceOracleCollateralPools[0][0]).to.be.equal(formatBytes32String("BNB"))

            const { calls: stableCoinReferencePrice } = mockedPriceOracle.smocked.stableCoinReferencePrice
            expect(stableCoinReferencePrice.length).to.be.equal(1)

            const { calls: peek } = mockedPriceFeed.smocked.peek
            expect(peek.length).to.be.equal(1)
          })
        })

        context("and debtAccumulatedRate == 12345", () => {
          it("should be success", async () => {
            await fixedSpreadLiquidationStrategy.grantRole(
              await fixedSpreadLiquidationStrategy.LIQUIDATION_ENGINE_ROLE(),
              deployerAddress
            )
            // mock contract
            mockedBookKeeper.smocked.collateralPools.will.return.with([
              BigNumber.from(0),
              UnitHelpers.WeiPerRay.mul(12345),
              UnitHelpers.WeiPerRay,
              BigNumber.from(0),
              BigNumber.from(0),
            ])
            mockedBookKeeper.smocked.confiscatePosition.will.return.with()
            mockedBookKeeper.smocked.moveCollateral.will.return.with()
            mockedBookKeeper.smocked.moveStablecoin.will.return.with()
            mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, 0])
            mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(UnitHelpers.WeiPerRay)
            mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(UnitHelpers.WeiPerWad.mul(2)), true])

            await fixedSpreadLiquidationStrategy.setCloseFactorBps(formatBytes32String("BNB"), 10)
            await fixedSpreadLiquidationStrategy.setLiquidatorIncentiveBps(formatBytes32String("BNB"), 1)
            await fixedSpreadLiquidationStrategy.setTreasuryFeesBps(formatBytes32String("BNB"), 1)

            await expect(
              fixedSpreadLiquidationStrategy.execute(
                formatBytes32String("BNB"),
                UnitHelpers.WeiPerWad,
                UnitHelpers.WeiPerWad.mul(98765),
                aliceAddress,
                UnitHelpers.WeiPerWad,
                ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [deployerAddress, []])
              )
            )
              .to.emit(fixedSpreadLiquidationStrategy, "FixedSpreadLiquidate")
              .withArgs(
                formatBytes32String("BNB"),
                UnitHelpers.WeiPerRad.mul(12345),
                UnitHelpers.WeiPerWad.mul(61725).div(10),
                UnitHelpers.WeiPerWad.mul(61725).div(100000),
                UnitHelpers.WeiPerWad.mul(61725).div(100000),
                aliceAddress,
                deployerAddress
              )

            const { calls: BookkeeperCollateralPools } = mockedBookKeeper.smocked.collateralPools
            expect(BookkeeperCollateralPools.length).to.be.equal(1)
            expect(BookkeeperCollateralPools[0][0]).to.be.equal(formatBytes32String("BNB"))

            const { calls: confiscatePosition } = mockedBookKeeper.smocked.confiscatePosition
            expect(confiscatePosition.length).to.be.equal(1)
            expect(confiscatePosition[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(confiscatePosition[0].positionAddress).to.be.equal(aliceAddress)
            expect(confiscatePosition[0].collateralCreditor).to.be.equal(fixedSpreadLiquidationStrategy.address)
            expect(confiscatePosition[0].stablecoinDebtor).to.be.equal(mockedSystemDebtEngine.address)
            expect(confiscatePosition[0].collateralValue).to.be.equal(UnitHelpers.WeiPerWad.mul(-61737345).div(10000))
            expect(confiscatePosition[0].debtShare).to.be.equal(UnitHelpers.WeiPerWad.mul(-1))

            const { calls: moveCollateral } = mockedBookKeeper.smocked.moveCollateral
            expect(moveCollateral.length).to.be.equal(2)
            //Give the collateral to the collateralRecipient
            expect(moveCollateral[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(moveCollateral[0].src).to.be.equal(fixedSpreadLiquidationStrategy.address)
            expect(moveCollateral[0].dst).to.be.equal(deployerAddress)
            expect(moveCollateral[0].wad).to.be.equal(UnitHelpers.WeiPerWad.mul(617311725).div(100000))
            //Give the treasury fees to System Debt Engine to be stored as system surplus
            expect(moveCollateral[1].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(moveCollateral[1].src).to.be.equal(fixedSpreadLiquidationStrategy.address)
            expect(moveCollateral[1].dst).to.be.equal(mockedSystemDebtEngine.address)
            expect(moveCollateral[1].wad).to.be.equal(UnitHelpers.WeiPerWad.mul(61725).div(100000))

            const { calls: PriceOracleCollateralPools } = mockedPriceOracle.smocked.collateralPools
            expect(PriceOracleCollateralPools.length).to.be.equal(1)
            expect(PriceOracleCollateralPools[0][0]).to.be.equal(formatBytes32String("BNB"))

            const { calls: stableCoinReferencePrice } = mockedPriceOracle.smocked.stableCoinReferencePrice
            expect(stableCoinReferencePrice.length).to.be.equal(1)

            const { calls: peek } = mockedPriceFeed.smocked.peek
            expect(peek.length).to.be.equal(1)
          })
        })
      })
    })

    context("when contract call FlashLending", () => {
      it("should be success", async () => {
        await fixedSpreadLiquidationStrategy.grantRole(
          await fixedSpreadLiquidationStrategy.LIQUIDATION_ENGINE_ROLE(),
          deployerAddress
        )
        // mock contract
        mockedBookKeeper.smocked.collateralPools.will.return.with([
          BigNumber.from(0),
          UnitHelpers.WeiPerRay.mul(3),
          UnitHelpers.WeiPerRay,
          BigNumber.from(0),
          BigNumber.from(0),
        ])
        mockedBookKeeper.smocked.confiscatePosition.will.return.with()
        mockedBookKeeper.smocked.moveCollateral.will.return.with()
        mockedBookKeeper.smocked.moveStablecoin.will.return.with()
        mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, 0])
        mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(UnitHelpers.WeiPerRay)
        mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(UnitHelpers.WeiPerWad), true])
        mockedFlashLendingCallee.smocked.flashLendingCall.will.return.with()

        await fixedSpreadLiquidationStrategy.setCloseFactorBps(formatBytes32String("BNB"), 10)
        await fixedSpreadLiquidationStrategy.setLiquidatorIncentiveBps(formatBytes32String("BNB"), 1)
        await fixedSpreadLiquidationStrategy.setTreasuryFeesBps(formatBytes32String("BNB"), 1)

        await expect(
          fixedSpreadLiquidationStrategy.execute(
            formatBytes32String("BNB"),
            UnitHelpers.WeiPerWad,
            UnitHelpers.WeiPerWad.mul(8),
            aliceAddress,
            UnitHelpers.WeiPerWad,
            ethers.utils.defaultAbiCoder.encode(
              ["address", "bytes"],
              [mockedFlashLendingCallee.address, ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])]
            )
          )
        )
          .to.emit(fixedSpreadLiquidationStrategy, "FixedSpreadLiquidate")
          .withArgs(
            formatBytes32String("BNB"),
            UnitHelpers.WeiPerRad.mul(3),
            UnitHelpers.WeiPerWad.mul(3),
            UnitHelpers.WeiPerWad.mul(3).div(10000),
            UnitHelpers.WeiPerWad.mul(3).div(10000),
            aliceAddress,
            mockedFlashLendingCallee.address
          )

        const { calls: BookkeeperCollateralPools } = mockedBookKeeper.smocked.collateralPools
        expect(BookkeeperCollateralPools.length).to.be.equal(1)
        expect(BookkeeperCollateralPools[0][0]).to.be.equal(formatBytes32String("BNB"))

        const { calls: confiscatePosition } = mockedBookKeeper.smocked.confiscatePosition
        expect(confiscatePosition.length).to.be.equal(1)
        expect(confiscatePosition[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(confiscatePosition[0].positionAddress).to.be.equal(aliceAddress)
        expect(confiscatePosition[0].collateralCreditor).to.be.equal(fixedSpreadLiquidationStrategy.address)
        expect(confiscatePosition[0].stablecoinDebtor).to.be.equal(mockedSystemDebtEngine.address)
        expect(confiscatePosition[0].collateralValue).to.be.equal(UnitHelpers.WeiPerWad.mul(-30006).div(10000))
        expect(confiscatePosition[0].debtShare).to.be.equal(UnitHelpers.WeiPerWad.mul(-1))

        const { calls: moveCollateral } = mockedBookKeeper.smocked.moveCollateral
        expect(moveCollateral.length).to.be.equal(2)
        //Give the collateral to the collateralRecipient
        expect(moveCollateral[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(moveCollateral[0].src).to.be.equal(fixedSpreadLiquidationStrategy.address)
        expect(moveCollateral[0].dst).to.be.equal(mockedFlashLendingCallee.address)
        expect(moveCollateral[0].wad).to.be.equal(UnitHelpers.WeiPerWad.mul(30003).div(10000))
        //Give the treasury fees to System Debt Engine to be stored as system surplus
        expect(moveCollateral[1].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(moveCollateral[1].src).to.be.equal(fixedSpreadLiquidationStrategy.address)
        expect(moveCollateral[1].dst).to.be.equal(mockedSystemDebtEngine.address)
        expect(moveCollateral[1].wad).to.be.equal(UnitHelpers.WeiPerWad.mul(3).div(10000))

        const { calls: PriceOracleCollateralPools } = mockedPriceOracle.smocked.collateralPools
        expect(PriceOracleCollateralPools.length).to.be.equal(1)
        expect(PriceOracleCollateralPools[0][0]).to.be.equal(formatBytes32String("BNB"))

        const { calls: stableCoinReferencePrice } = mockedPriceOracle.smocked.stableCoinReferencePrice
        expect(stableCoinReferencePrice.length).to.be.equal(1)

        const { calls: peek } = mockedPriceFeed.smocked.peek
        expect(peek.length).to.be.equal(1)
      })
    })
  })
})
