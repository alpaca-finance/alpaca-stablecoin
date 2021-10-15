import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { smockit, MockContract } from "@eth-optimism/smock"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"
import {
  AccessControlConfig,
  AccessControlConfig__factory,
  CollateralPoolConfig,
  CollateralPoolConfig__factory,
} from "../../../typechain"
import { time, timeLog, timeStamp } from "console"
import { DateTime } from "luxon"
import * as AssertHelpers from "../../helper/assert"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { parseEther, keccak256, toUtf8Bytes, formatBytes32String } = ethers.utils

type fixture = {
  collateralPoolConfig: CollateralPoolConfig
  accessControlConfig: AccessControlConfig
  mockedSimplePriceFeed: MockContract
  mockedIbTokenAdapter: MockContract
}

const COLLATERAL_POOL_ID = formatBytes32String("ibDUMMY")
const CLOSE_FACTOR_BPS = BigNumber.from(5000)
const LIQUIDATOR_INCENTIVE_BPS = BigNumber.from(12500)
const TREASURY_FEE_BPS = BigNumber.from(2500)

const nHoursAgoInSec = (now: DateTime, n: number): BigNumber => {
  const d = now.minus({ hours: n })
  return BigNumber.from(Math.floor(d.toSeconds()))
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  const AccessControlConfig = (await ethers.getContractFactory(
    "AccessControlConfig",
    deployer
  )) as AccessControlConfig__factory
  const accessControlConfig = (await upgrades.deployProxy(AccessControlConfig, [])) as AccessControlConfig

  const mockedSimplePriceFeed = await smockit(await ethers.getContractFactory("SimplePriceFeed", deployer))

  const mockedIbTokenAdapter = await smockit(await ethers.getContractFactory("IbTokenAdapter", deployer))

  // Deploy mocked FlashMintModule
  const CollateralPoolConfig = (await ethers.getContractFactory(
    "CollateralPoolConfig",
    deployer
  )) as CollateralPoolConfig__factory
  const collateralPoolConfig = (await upgrades.deployProxy(CollateralPoolConfig, [
    accessControlConfig.address,
  ])) as CollateralPoolConfig

  return {
    collateralPoolConfig,
    accessControlConfig,
    mockedSimplePriceFeed,
    mockedIbTokenAdapter,
  }
}

describe("CollateralPoolConfig", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string

  // Contracts
  let mockedSimplePriceFeed: MockContract
  let mockedIbTokenAdapter: MockContract
  let accessControlConfig: AccessControlConfig

  let collateralPoolConfig: CollateralPoolConfig
  let collateralPoolConfigAsAlice: CollateralPoolConfig

  beforeEach(async () => {
    ;({ collateralPoolConfig, accessControlConfig, mockedSimplePriceFeed, mockedIbTokenAdapter } =
      await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    collateralPoolConfigAsAlice = CollateralPoolConfig__factory.connect(
      collateralPoolConfig.address,
      alice
    ) as CollateralPoolConfig
  })
  describe("#initCollateralPool", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(
          collateralPoolConfigAsAlice.initCollateralPool(
            COLLATERAL_POOL_ID,
            WeiPerRad.mul(10000000),
            0,
            mockedSimplePriceFeed.address,
            0,
            WeiPerRay,
            mockedIbTokenAdapter.address,
            CLOSE_FACTOR_BPS,
            LIQUIDATOR_INCENTIVE_BPS,
            TREASURY_FEE_BPS,
            AddressZero
          )
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when collateral pool already init", () => {
      it("should be revert", async () => {
        await collateralPoolConfig.initCollateralPool(
          COLLATERAL_POOL_ID,
          WeiPerRad.mul(10000000),
          0,
          mockedSimplePriceFeed.address,
          0,
          WeiPerRay,
          mockedIbTokenAdapter.address,
          CLOSE_FACTOR_BPS,
          LIQUIDATOR_INCENTIVE_BPS,
          TREASURY_FEE_BPS,
          AddressZero
        )
        await expect(
          collateralPoolConfig.initCollateralPool(
            COLLATERAL_POOL_ID,
            WeiPerRad.mul(10000000),
            0,
            mockedSimplePriceFeed.address,
            0,
            WeiPerRay,
            mockedIbTokenAdapter.address,
            CLOSE_FACTOR_BPS,
            LIQUIDATOR_INCENTIVE_BPS,
            TREASURY_FEE_BPS,
            AddressZero
          )
        ).to.be.revertedWith("CollateralPoolConfig/collateral-pool-already-init")
      })
    })
    context("when stability fee rate invalid", () => {
      it("should be revert", async () => {
        await expect(
          collateralPoolConfig.initCollateralPool(
            COLLATERAL_POOL_ID,
            WeiPerRad.mul(10000000),
            0,
            mockedSimplePriceFeed.address,
            0,
            WeiPerWad,
            mockedIbTokenAdapter.address,
            CLOSE_FACTOR_BPS,
            LIQUIDATOR_INCENTIVE_BPS,
            TREASURY_FEE_BPS,
            AddressZero
          )
        ).to.be.revertedWith("CollateralPoolConfig/invalid-stability-fee-rate")
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await collateralPoolConfig.initCollateralPool(
          COLLATERAL_POOL_ID,
          WeiPerRad.mul(10000000),
          0,
          mockedSimplePriceFeed.address,
          0,
          WeiPerRay,
          mockedIbTokenAdapter.address,
          CLOSE_FACTOR_BPS,
          LIQUIDATOR_INCENTIVE_BPS,
          TREASURY_FEE_BPS,
          AddressZero
        )
        expect(await (await collateralPoolConfig.collateralPools(COLLATERAL_POOL_ID)).adapter).to.be.equal(
          mockedIbTokenAdapter.address
        )
      })
    })
  })
  describe("#setPriceWithSafetyMargin", () => {
    context("when the caller is not the RriceOracle Role", () => {
      it("should be revert", async () => {
        await expect(
          collateralPoolConfigAsAlice.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)
        ).to.be.revertedWith("!priceOracleRole")
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await accessControlConfig.grantRole(await accessControlConfig.PRICE_ORACLE_ROLE(), deployerAddress)
        await expect(collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay))
          .to.be.emit(collateralPoolConfig, "LogSetPriceWithSafetyMargin")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, WeiPerRay)
      })
    })
  })
  describe("#setDebtCeiling", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(collateralPoolConfigAsAlice.setDebtCeiling(COLLATERAL_POOL_ID, WeiPerRay)).to.be.revertedWith(
          "!ownerRole"
        )
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await expect(collateralPoolConfig.setDebtCeiling(COLLATERAL_POOL_ID, WeiPerRay))
          .to.be.emit(collateralPoolConfig, "LogSetDebtCeiling")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, WeiPerRay)
      })
    })
  })
  describe("#setDebtFloor", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(collateralPoolConfigAsAlice.setDebtFloor(COLLATERAL_POOL_ID, WeiPerRay)).to.be.revertedWith(
          "!ownerRole"
        )
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await expect(collateralPoolConfig.setDebtFloor(COLLATERAL_POOL_ID, WeiPerRay))
          .to.be.emit(collateralPoolConfig, "LogSetDebtFloor")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, WeiPerRay)
      })
    })
  })
  describe("#setDebtFloor", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(collateralPoolConfigAsAlice.setDebtFloor(COLLATERAL_POOL_ID, WeiPerRay)).to.be.revertedWith(
          "!ownerRole"
        )
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await expect(collateralPoolConfig.setDebtFloor(COLLATERAL_POOL_ID, WeiPerRay))
          .to.be.emit(collateralPoolConfig, "LogSetDebtFloor")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, WeiPerRay)
      })
    })
  })
  describe("#setPriceFeed", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(
          collateralPoolConfigAsAlice.setPriceFeed(COLLATERAL_POOL_ID, mockedSimplePriceFeed.address)
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await expect(collateralPoolConfig.setPriceFeed(COLLATERAL_POOL_ID, mockedSimplePriceFeed.address))
          .to.be.emit(collateralPoolConfig, "LogSetPriceFeed")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, mockedSimplePriceFeed.address)
      })
    })
  })
  describe("#setLiquidationRatio", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(collateralPoolConfigAsAlice.setLiquidationRatio(COLLATERAL_POOL_ID, WeiPerRay)).to.be.revertedWith(
          "!ownerRole"
        )
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await expect(collateralPoolConfig.setLiquidationRatio(COLLATERAL_POOL_ID, WeiPerRay))
          .to.be.emit(collateralPoolConfig, "LogSetLiquidationRatio")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, WeiPerRay)
      })
    })
  })
  describe("#setStabilityFeeRate", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(collateralPoolConfigAsAlice.setStabilityFeeRate(COLLATERAL_POOL_ID, WeiPerRay)).to.be.revertedWith(
          "!ownerRole"
        )
      })
    })
    context("when stability fee rate invalid", () => {
      it("should be revert", async () => {
        await expect(collateralPoolConfig.setStabilityFeeRate(COLLATERAL_POOL_ID, WeiPerWad)).to.be.revertedWith(
          "CollateralPoolConfig/invalid-stability-fee-rate"
        )
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await expect(collateralPoolConfig.setStabilityFeeRate(COLLATERAL_POOL_ID, WeiPerRay))
          .to.be.emit(collateralPoolConfig, "LogSetStabilityFeeRate")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, WeiPerRay)
      })
    })
  })
  describe("#setAdapter", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(
          collateralPoolConfigAsAlice.setAdapter(COLLATERAL_POOL_ID, mockedIbTokenAdapter.address)
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await expect(collateralPoolConfig.setAdapter(COLLATERAL_POOL_ID, mockedIbTokenAdapter.address))
          .to.be.emit(collateralPoolConfig, "LogSetAdapter")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, mockedIbTokenAdapter.address)
      })
    })
  })
  describe("#setCloseFactorBps", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(
          collateralPoolConfigAsAlice.setCloseFactorBps(COLLATERAL_POOL_ID, CLOSE_FACTOR_BPS)
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when close factor bps is more than 10000", () => {
      it("should be revert", async () => {
        await expect(
          collateralPoolConfig.setCloseFactorBps(COLLATERAL_POOL_ID, BigNumber.from(20000))
        ).to.be.revertedWith("CollateralPoolConfig/invalid-close-factor-bps")
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await expect(collateralPoolConfig.setCloseFactorBps(COLLATERAL_POOL_ID, CLOSE_FACTOR_BPS))
          .to.be.emit(collateralPoolConfig, "LogSetCloseFactorBps")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, CLOSE_FACTOR_BPS)
      })
    })
  })
  describe("#setLiquidatorIncentiveBps", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(
          collateralPoolConfigAsAlice.setLiquidatorIncentiveBps(COLLATERAL_POOL_ID, LIQUIDATOR_INCENTIVE_BPS)
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when liquidator incentive bps is more than 20000", () => {
      it("should be revert", async () => {
        await expect(
          collateralPoolConfig.setLiquidatorIncentiveBps(COLLATERAL_POOL_ID, BigNumber.from(20000))
        ).to.be.revertedWith("CollateralPoolConfig/invalid-liquidator-incentive-bps")
      })
    })
    context("when liquidator incentive bps is less than 10000", () => {
      it("should be revert", async () => {
        await expect(
          collateralPoolConfig.setLiquidatorIncentiveBps(COLLATERAL_POOL_ID, BigNumber.from(9000))
        ).to.be.revertedWith("CollateralPoolConfig/invalid-liquidator-incentive-bps")
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await expect(collateralPoolConfig.setLiquidatorIncentiveBps(COLLATERAL_POOL_ID, LIQUIDATOR_INCENTIVE_BPS))
          .to.be.emit(collateralPoolConfig, "LogSetLiquidatorIncentiveBps")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, LIQUIDATOR_INCENTIVE_BPS)
      })
    })
  })
  describe("#setTreasuryFeesBps", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(
          collateralPoolConfigAsAlice.setTreasuryFeesBps(COLLATERAL_POOL_ID, TREASURY_FEE_BPS)
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when treasury fee bps is more than 9000", () => {
      it("should be revert", async () => {
        await expect(
          collateralPoolConfig.setTreasuryFeesBps(COLLATERAL_POOL_ID, BigNumber.from(20000))
        ).to.be.revertedWith("CollateralPoolConfig/invalid-treasury-fees-bps")
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await expect(collateralPoolConfig.setTreasuryFeesBps(COLLATERAL_POOL_ID, TREASURY_FEE_BPS))
          .to.be.emit(collateralPoolConfig, "LogSetTreasuryFeesBps")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, TREASURY_FEE_BPS)
      })
    })
  })
  describe("#setTotalDebtShare", () => {
    context("when the caller is not the Bookkeeper Role", () => {
      it("should be revert", async () => {
        await expect(collateralPoolConfigAsAlice.setTotalDebtShare(COLLATERAL_POOL_ID, WeiPerRay)).to.be.revertedWith(
          "!bookKeeperRole"
        )
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await accessControlConfig.grantRole(await accessControlConfig.BOOK_KEEPER_ROLE(), deployerAddress)
        await expect(collateralPoolConfig.setTotalDebtShare(COLLATERAL_POOL_ID, WeiPerRay))
          .to.be.emit(collateralPoolConfig, "LogSetTotalDebtShare")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, WeiPerRay)
      })
    })
  })
  describe("#setDebtAccumulatedRate", () => {
    context("when the caller is not the Bookkeeper Role", () => {
      it("should be revert", async () => {
        await expect(
          collateralPoolConfigAsAlice.setDebtAccumulatedRate(COLLATERAL_POOL_ID, WeiPerRay)
        ).to.be.revertedWith("!bookKeeperRole")
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await accessControlConfig.grantRole(await accessControlConfig.BOOK_KEEPER_ROLE(), deployerAddress)
        await expect(collateralPoolConfig.setDebtAccumulatedRate(COLLATERAL_POOL_ID, WeiPerRay))
          .to.be.emit(collateralPoolConfig, "LogSetDebtAccumulatedRate")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, WeiPerRay)
      })
    })
  })
  describe("#setStrategy", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        await expect(collateralPoolConfigAsAlice.setStrategy(COLLATERAL_POOL_ID, AddressZero)).to.be.revertedWith(
          "!ownerRole"
        )
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await expect(collateralPoolConfig.setStrategy(COLLATERAL_POOL_ID, AddressZero))
          .to.be.emit(collateralPoolConfig, "LogSetStrategy")
          .withArgs(deployerAddress, COLLATERAL_POOL_ID, AddressZero)
      })
    })
  })
  describe("#updateLastAccumulationTime", () => {
    context("when the caller is not the StabilityFeeCollector role", () => {
      it("should be revert", async () => {
        await expect(collateralPoolConfigAsAlice.updateLastAccumulationTime(COLLATERAL_POOL_ID)).to.be.revertedWith(
          "!stabilityFeeCollectorRole"
        )
      })
    })
    context("when parameters are valid", () => {
      it("should success", async () => {
        await accessControlConfig.grantRole(await accessControlConfig.STABILITY_FEE_COLLECTOR_ROLE(), deployerAddress)
        await collateralPoolConfig.updateLastAccumulationTime(COLLATERAL_POOL_ID)

        const now = DateTime.now()
        AssertHelpers.assertAlmostEqual(
          (await collateralPoolConfig.collateralPools(COLLATERAL_POOL_ID)).lastAccumulationTime.toString(),
          nHoursAgoInSec(now, 0).toString()
        )
      })
    })
  })
  describe("#getTotalDebtShare", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await accessControlConfig.grantRole(await accessControlConfig.BOOK_KEEPER_ROLE(), deployerAddress)
        await collateralPoolConfig.setTotalDebtShare(COLLATERAL_POOL_ID, WeiPerRay)

        expect(await collateralPoolConfig.getTotalDebtShare(COLLATERAL_POOL_ID)).to.be.equal(WeiPerRay)
      })
    })
  })
  describe("#getDebtAccumulatedRate", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await accessControlConfig.grantRole(await accessControlConfig.BOOK_KEEPER_ROLE(), deployerAddress)
        await collateralPoolConfig.setDebtAccumulatedRate(COLLATERAL_POOL_ID, WeiPerRay)

        expect(await collateralPoolConfig.getDebtAccumulatedRate(COLLATERAL_POOL_ID)).to.be.equal(WeiPerRay)
      })
    })
  })
  describe("#getPriceWithSafetyMargin", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await accessControlConfig.grantRole(await accessControlConfig.PRICE_ORACLE_ROLE(), deployerAddress)
        await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

        expect(await collateralPoolConfig.getPriceWithSafetyMargin(COLLATERAL_POOL_ID)).to.be.equal(WeiPerRay)
      })
    })
  })
  describe("#getDebtCeiling", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await collateralPoolConfig.setDebtCeiling(COLLATERAL_POOL_ID, WeiPerRay)

        expect(await collateralPoolConfig.getDebtCeiling(COLLATERAL_POOL_ID)).to.be.equal(WeiPerRay)
      })
    })
  })
  describe("#getDebtFloor", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await collateralPoolConfig.setDebtFloor(COLLATERAL_POOL_ID, WeiPerRay)

        expect(await collateralPoolConfig.getDebtFloor(COLLATERAL_POOL_ID)).to.be.equal(WeiPerRay)
      })
    })
  })
  describe("#getPriceFeed", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await collateralPoolConfig.setPriceFeed(COLLATERAL_POOL_ID, mockedSimplePriceFeed.address)

        expect(await collateralPoolConfig.getPriceFeed(COLLATERAL_POOL_ID)).to.be.equal(mockedSimplePriceFeed.address)
      })
    })
  })
  describe("#getLiquidationRatio", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await collateralPoolConfig.setLiquidationRatio(COLLATERAL_POOL_ID, WeiPerRay)

        expect(await collateralPoolConfig.getLiquidationRatio(COLLATERAL_POOL_ID)).to.be.equal(WeiPerRay)
      })
    })
  })
  describe("#getStabilityFeeRate", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await collateralPoolConfig.setStabilityFeeRate(COLLATERAL_POOL_ID, WeiPerRay)

        expect(await collateralPoolConfig.getStabilityFeeRate(COLLATERAL_POOL_ID)).to.be.equal(WeiPerRay)
      })
    })
  })
  describe("#getLastAccumulationTime", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await accessControlConfig.grantRole(await accessControlConfig.STABILITY_FEE_COLLECTOR_ROLE(), deployerAddress)
        await collateralPoolConfig.updateLastAccumulationTime(COLLATERAL_POOL_ID)

        const now = DateTime.now()
        AssertHelpers.assertAlmostEqual(
          (await collateralPoolConfig.collateralPools(COLLATERAL_POOL_ID)).lastAccumulationTime.toString(),
          nHoursAgoInSec(now, 0).toString()
        )
      })
    })
  })
  describe("#getAdapter", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await collateralPoolConfig.setAdapter(COLLATERAL_POOL_ID, mockedIbTokenAdapter.address)

        expect(await collateralPoolConfig.getAdapter(COLLATERAL_POOL_ID)).to.be.equal(mockedIbTokenAdapter.address)
      })
    })
  })
  describe("#getCloseFactorBps", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await collateralPoolConfig.setCloseFactorBps(COLLATERAL_POOL_ID, CLOSE_FACTOR_BPS)

        expect(await collateralPoolConfig.getCloseFactorBps(COLLATERAL_POOL_ID)).to.be.equal(CLOSE_FACTOR_BPS)
      })
    })
  })
  describe("#getLiquidatorIncentiveBps", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await collateralPoolConfig.setLiquidatorIncentiveBps(COLLATERAL_POOL_ID, LIQUIDATOR_INCENTIVE_BPS)

        expect(await collateralPoolConfig.getLiquidatorIncentiveBps(COLLATERAL_POOL_ID)).to.be.equal(
          LIQUIDATOR_INCENTIVE_BPS
        )
      })
    })
  })
  describe("#getTreasuryFeesBps", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await collateralPoolConfig.setTreasuryFeesBps(COLLATERAL_POOL_ID, TREASURY_FEE_BPS)

        expect(await collateralPoolConfig.getTreasuryFeesBps(COLLATERAL_POOL_ID)).to.be.equal(TREASURY_FEE_BPS)
      })
    })
  })
  describe("#getStrategy", () => {
    context("when parameters are valid", () => {
      it("should success", async () => {
        await collateralPoolConfig.setStrategy(COLLATERAL_POOL_ID, AddressZero)

        expect(await collateralPoolConfig.getStrategy(COLLATERAL_POOL_ID)).to.be.equal(AddressZero)
      })
    })
  })
})
