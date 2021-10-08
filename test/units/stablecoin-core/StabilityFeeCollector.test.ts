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
} from "../../../typechain"
import { smoddit, ModifiableContract } from "@eth-optimism/smock"

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
  collateralPoolConfig: ModifiableContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  const CollateralPoolConfig = await smoddit("CollateralPoolConfig")
  const collateralPoolConfig = (await upgrades.deployProxy(CollateralPoolConfig, [])) as ModifiableContract

  // Deploy mocked BookKeeper
  const BookKeeper = await smoddit("BookKeeper")
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [collateralPoolConfig.address])) as ModifiableContract

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

  await collateralPoolConfig.grantRole(
    await collateralPoolConfig.STABILITY_FEE_COLLECTOR_ROLE(),
    stabilityFeeCollector.address
  )
  await bookKeeper.grantRole(await collateralPoolConfig.STABILITY_FEE_COLLECTOR_ROLE(), stabilityFeeCollector.address)
  await collateralPoolConfig.grantRole(await collateralPoolConfig.BOOK_KEEPER_ROLE(), bookKeeper.address)

  await collateralPoolConfig.initCollateralPool(
    formatBytes32String("BNB"),
    0,
    0,
    simplePriceFeed.address,
    0,
    0,
    tokenAdapter.address,
    0,
    0,
    0
  )

  return { stabilityFeeCollector, bookKeeper, collateralPoolConfig }
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
  let collateralPoolConfig: ModifiableContract

  let stabilityFeeCollector: StabilityFeeCollector
  let stabilityFeeCollectorAsAlice: StabilityFeeCollector

  beforeEach(async () => {
    ;({ stabilityFeeCollector, bookKeeper, collateralPoolConfig } = await waffle.loadFixture(loadFixtureHandler))
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
          BigNumber.from("10000000000000000000000000").toString()
        )
      })
    })
  })

  // describe("#setGlobalStabilityFeeRate", () => {
  //   context("when the caller is not the owner", async () => {
  //     it("should revert", async () => {
  //       await expect(stabilityFeeCollectorAsAlice.setGlobalStabilityFeeRate(UnitHelpers.WeiPerWad)).to.be.revertedWith(
  //         "!ownerRole"
  //       )
  //     })
  //   })
  //   context("when the caller is the owner", async () => {
  //     it("should be able to call setGlobalStabilityFeeRate", async () => {
  //       await stabilityFeeCollector.grantRole(await stabilityFeeCollector.OWNER_ROLE(), deployerAddress)

  //       // init BNB pool
  //       await stabilityFeeCollector.init(formatBytes32String("BNB"))

  //       await expect(stabilityFeeCollector.setGlobalStabilityFeeRate(UnitHelpers.WeiPerWad))
  //         .to.emit(stabilityFeeCollector, "SetGlobalStabilityFeeRate")
  //         .withArgs(deployerAddress, UnitHelpers.WeiPerWad)
  //     })
  //   })
  // })

  // describe("#setSystemDebtEngine", () => {
  //   context("when the caller is not the owner", async () => {
  //     it("should revert", async () => {
  //       await expect(stabilityFeeCollectorAsAlice.setSystemDebtEngine(mockedBookKeeper.address)).to.be.revertedWith(
  //         "!ownerRole"
  //       )
  //     })
  //   })
  //   context("when the caller is the owner", async () => {
  //     it("should be able to call setSystemDebtEngine", async () => {
  //       await stabilityFeeCollector.grantRole(await stabilityFeeCollector.OWNER_ROLE(), deployerAddress)

  //       // init BNB pool
  //       await stabilityFeeCollector.init(formatBytes32String("BNB"))

  //       await expect(stabilityFeeCollector.setSystemDebtEngine(mockedBookKeeper.address))
  //         .to.emit(stabilityFeeCollector, "SetSystemDebtEngine")
  //         .withArgs(deployerAddress, mockedBookKeeper.address)
  //     })
  //   })
  // })

  // describe("#setStabilityFeeRate", () => {
  //   context("when the caller is not the owner", async () => {
  //     it("should revert", async () => {
  //       await expect(
  //         stabilityFeeCollectorAsAlice.setStabilityFeeRate(
  //           formatBytes32String("BNB"),
  //           BigNumber.from("1000000000315522921573372069")
  //         )
  //       ).to.be.revertedWith("!ownerRole")
  //     })
  //   })
  //   context("when the caller is the owner", async () => {
  //     it("should be able to call setStabilityFeeRate", async () => {
  //       await stabilityFeeCollector.grantRole(await stabilityFeeCollector.OWNER_ROLE(), deployerAddress)

  //       // init BNB pool
  //       await stabilityFeeCollector.init(formatBytes32String("BNB"))

  //       await expect(
  //         stabilityFeeCollector.setStabilityFeeRate(
  //           formatBytes32String("BNB"),
  //           BigNumber.from("1000000000315522921573372069")
  //         )
  //       )
  //         .to.emit(stabilityFeeCollector, "SetStabilityFeeRate")
  //         .withArgs(deployerAddress, formatBytes32String("BNB"), BigNumber.from("1000000000315522921573372069"))
  //     })
  //   })
  // })

  // describe("#pause", () => {
  //   context("when role can't access", () => {
  //     it("should revert", async () => {
  //       await expect(stabilityFeeCollectorAsAlice.pause()).to.be.revertedWith("!ownerRole or !govRole")
  //     })
  //   })

  //   context("when role can access", () => {
  //     context("and role is owner role", () => {
  //       it("should be success", async () => {
  //         await stabilityFeeCollector.grantRole(await stabilityFeeCollector.OWNER_ROLE(), deployerAddress)
  //         await stabilityFeeCollector.pause()
  //       })
  //     })
  //   })

  //   context("and role is gov role", () => {
  //     it("should be success", async () => {
  //       await stabilityFeeCollector.grantRole(await stabilityFeeCollector.GOV_ROLE(), deployerAddress)
  //       await stabilityFeeCollector.pause()
  //     })
  //   })

  //   context("when pause contract", () => {
  //     it("should be success", async () => {
  //       await stabilityFeeCollector.grantRole(await stabilityFeeCollector.OWNER_ROLE(), deployerAddress)
  //       await stabilityFeeCollector.pause()

  //       await expect(
  //         stabilityFeeCollector.setStabilityFeeRate(
  //           formatBytes32String("BNB"),
  //           BigNumber.from("1000000000315522921573372069")
  //         )
  //       ).to.be.revertedWith("Pausable: paused")
  //     })
  //   })
  // })

  // describe("#unpause", () => {
  //   context("when role can't access", () => {
  //     it("should revert", async () => {
  //       await expect(stabilityFeeCollectorAsAlice.unpause()).to.be.revertedWith("!ownerRole or !govRole")
  //     })
  //   })

  //   context("when role can access", () => {
  //     context("and role is owner role", () => {
  //       it("should be success", async () => {
  //         await stabilityFeeCollector.grantRole(await stabilityFeeCollector.OWNER_ROLE(), deployerAddress)
  //         await stabilityFeeCollector.pause()
  //         await stabilityFeeCollector.unpause()
  //       })
  //     })

  //     context("and role is gov role", () => {
  //       it("should be success", async () => {
  //         await stabilityFeeCollector.grantRole(await stabilityFeeCollector.GOV_ROLE(), deployerAddress)
  //         await stabilityFeeCollector.pause()
  //         await stabilityFeeCollector.unpause()
  //       })
  //     })
  //   })

  //   context("when unpause contract", () => {
  //     it("should be success", async () => {
  //       await stabilityFeeCollector.grantRole(await stabilityFeeCollector.OWNER_ROLE(), deployerAddress)

  //       // pause contract
  //       await stabilityFeeCollector.pause()

  //       // unpause contract
  //       await stabilityFeeCollector.unpause()

  //       await expect(
  //         stabilityFeeCollector.setStabilityFeeRate(
  //           formatBytes32String("BNB"),
  //           BigNumber.from("1000000000315522921573372069")
  //         )
  //       )
  //         .to.emit(stabilityFeeCollector, "SetStabilityFeeRate")
  //         .withArgs(deployerAddress, formatBytes32String("BNB"), BigNumber.from("1000000000315522921573372069"))
  //     })
  //   })
  // })
})
