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
import { smoddit, ModifiableContract, ModifiableContractFactory } from "@eth-optimism/smock"

import * as TimeHelpers from "../../helper/time"
import * as AssertHelpers from "../../helper/assert"
import * as UnitHelpers from "../../helper/unit"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { formatBytes32String } = ethers.utils

type fixture = {
  stabilityFeeCollector: StabilityFeeCollector
  bookKeeper: ModifiableContract
  collateralPoolConfig: CollateralPoolConfig
  accessControlConfig: AccessControlConfig
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  const AccessControlConfig = (await ethers.getContractFactory(
    "AccessControlConfig",
    deployer
  )) as AccessControlConfig__factory
  const accessControlConfig = (await upgrades.deployProxy(AccessControlConfig, [])) as AccessControlConfig

  const CollateralPoolConfig = (await ethers.getContractFactory(
    "CollateralPoolConfig",
    deployer
  )) as CollateralPoolConfig__factory
  const collateralPoolConfig = (await upgrades.deployProxy(CollateralPoolConfig, [
    accessControlConfig.address,
  ])) as CollateralPoolConfig

  // Deploy mocked BookKeeper
  const BookKeeper = await smoddit("BookKeeper")
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [
    collateralPoolConfig.address,
    accessControlConfig.address,
  ])) as ModifiableContract

  const SimplePriceFeed = await smoddit("SimplePriceFeed")
  const simplePriceFeed = (await upgrades.deployProxy(SimplePriceFeed, [])) as ModifiableContract

  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const bep20 = await BEP20.deploy("BTOKEN", "BTOKEN")

  const TokenAdapter = await smoddit("TokenAdapter")
  const tokenAdapter = (await upgrades.deployProxy(TokenAdapter, [
    bookKeeper.address,
    formatBytes32String("BNB"),
    bep20.address,
  ])) as ModifiableContract

  // Deploy StabilityFeeCollector
  const StabilityFeeCollector = (await ethers.getContractFactory(
    "StabilityFeeCollector",
    deployer
  )) as StabilityFeeCollector__factory
  const stabilityFeeCollector = (await upgrades.deployProxy(StabilityFeeCollector, [
    bookKeeper.address,
  ])) as StabilityFeeCollector

  await accessControlConfig.grantRole(
    await accessControlConfig.STABILITY_FEE_COLLECTOR_ROLE(),
    stabilityFeeCollector.address
  )
  await accessControlConfig.grantRole(await accessControlConfig.BOOK_KEEPER_ROLE(), bookKeeper.address)

  await collateralPoolConfig.initCollateralPool(
    formatBytes32String("BNB"),
    0,
    0,
    simplePriceFeed.address,
    0,
    UnitHelpers.WeiPerRay,
    tokenAdapter.address,
    0,
    0,
    0,
    AddressZero
  )

  return { stabilityFeeCollector, bookKeeper, collateralPoolConfig, accessControlConfig }
}

describe("StabilityFeeCollector", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string

  // Contracts
  let bookKeeper: ModifiableContract
  let collateralPoolConfig: CollateralPoolConfig
  let collateralPoolConfigAsAlice: CollateralPoolConfig

  let accessControlConfig: AccessControlConfig
  let accessControlConfigAsAlice: AccessControlConfig

  let stabilityFeeCollector: StabilityFeeCollector
  let stabilityFeeCollectorAsAlice: StabilityFeeCollector

  beforeEach(async () => {
    ;({ stabilityFeeCollector, bookKeeper, collateralPoolConfig, accessControlConfig } = await waffle.loadFixture(
      loadFixtureHandler
    ))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    stabilityFeeCollectorAsAlice = StabilityFeeCollector__factory.connect(
      stabilityFeeCollector.address,
      alice
    ) as StabilityFeeCollector

    accessControlConfigAsAlice = AccessControlConfig__factory.connect(
      accessControlConfig.address,
      alice
    ) as AccessControlConfig

    collateralPoolConfigAsAlice = CollateralPoolConfig__factory.connect(
      collateralPoolConfig.address,
      alice
    ) as CollateralPoolConfig
  })

  describe("#collect", () => {
    context("when call collect", async () => {
      it("should be rate to ~ 1%", async () => {
        // rate ~ 1% annually
        // r^31536000 = 1.01
        // r =~ 1000000000315522921573372069...
        await collateralPoolConfig.setStabilityFeeRate(
          formatBytes32String("BNB"),
          BigNumber.from("1000000000315522921573372069")
        )
        // time increase 1 year
        await TimeHelpers.increase(TimeHelpers.duration.seconds(ethers.BigNumber.from("31536000")))
        // mock bookeeper
        // set debtAccumulatedRate = 1 ray

        await stabilityFeeCollectorAsAlice.collect(formatBytes32String("BNB"))

        // rate ~ 0.01 ray ~ 1%
        const collateralPool = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
        console.log("collateralPool.debtAccumulatedRate", collateralPool.debtAccumulatedRate.toString())
        AssertHelpers.assertAlmostEqual(
          collateralPool.debtAccumulatedRate.toString(),
          ethers.utils.parseEther("1.01").mul(1e9).toString()
        )
      })
    })
  })

  describe("#setGlobalStabilityFeeRate", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(stabilityFeeCollectorAsAlice.setGlobalStabilityFeeRate(UnitHelpers.WeiPerWad)).to.be.revertedWith(
          "!ownerRole"
        )
      })
    })
    context("when the caller is the owner", async () => {
      it("should be able to call setGlobalStabilityFeeRate", async () => {
        await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)

        await expect(stabilityFeeCollector.setGlobalStabilityFeeRate(UnitHelpers.WeiPerWad))
          .to.emit(stabilityFeeCollector, "LogSetGlobalStabilityFeeRate")
          .withArgs(deployerAddress, UnitHelpers.WeiPerWad)
      })
    })
  })

  describe("#setSystemDebtEngine", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(stabilityFeeCollectorAsAlice.setSystemDebtEngine(bookKeeper.address)).to.be.revertedWith(
          "!ownerRole"
        )
      })
    })
    context("when the caller is the owner", async () => {
      it("should be able to call setSystemDebtEngine", async () => {
        await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)

        await expect(stabilityFeeCollector.setSystemDebtEngine(bookKeeper.address))
          .to.emit(stabilityFeeCollector, "LogSetSystemDebtEngine")
          .withArgs(deployerAddress, bookKeeper.address)
      })
    })
  })

  describe("#setStabilityFeeRate", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          collateralPoolConfigAsAlice.setStabilityFeeRate(
            formatBytes32String("BNB"),
            BigNumber.from("1000000000315522921573372069")
          )
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when the caller is the owner", async () => {
      it("should be able to call setStabilityFeeRate", async () => {
        await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)

        await expect(
          collateralPoolConfig.setStabilityFeeRate(
            formatBytes32String("BNB"),
            BigNumber.from("1000000000315522921573372069")
          )
        )
          .to.emit(collateralPoolConfig, "LogSetStabilityFeeRate")
          .withArgs(deployerAddress, formatBytes32String("BNB"), BigNumber.from("1000000000315522921573372069"))
      })
    })
  })

  describe("#pause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        await expect(stabilityFeeCollectorAsAlice.pause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)
          await stabilityFeeCollector.pause()
        })
      })
    })

    context("and role is gov role", () => {
      it("should be success", async () => {
        await accessControlConfig.grantRole(await accessControlConfig.GOV_ROLE(), deployerAddress)
        await stabilityFeeCollector.pause()
      })
    })
  })

  describe("#unpause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        await expect(stabilityFeeCollectorAsAlice.unpause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)
          await stabilityFeeCollector.pause()
          await stabilityFeeCollector.unpause()
        })
      })

      context("and role is gov role", () => {
        it("should be success", async () => {
          await accessControlConfig.grantRole(await accessControlConfig.GOV_ROLE(), deployerAddress)
          await stabilityFeeCollector.pause()
          await stabilityFeeCollector.unpause()
        })
      })
    })

    context("when unpause contract", () => {
      it("should be success", async () => {
        await accessControlConfig.grantRole(await accessControlConfig.OWNER_ROLE(), deployerAddress)

        // pause contract
        await stabilityFeeCollector.pause()

        // unpause contract
        await stabilityFeeCollector.unpause()

        await expect(
          collateralPoolConfig.setStabilityFeeRate(
            formatBytes32String("BNB"),
            BigNumber.from("1000000000315522921573372069")
          )
        )
          .to.emit(collateralPoolConfig, "LogSetStabilityFeeRate")
          .withArgs(deployerAddress, formatBytes32String("BNB"), BigNumber.from("1000000000315522921573372069"))
      })
    })
  })
})
