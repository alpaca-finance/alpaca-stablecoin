import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { BookKeeper__factory, CDPManager, CDPManager__factory, BookKeeper } from "../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../helper/unit"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { parseEther, formatBytes32String } = ethers.utils

type fixture = {
  bookKeeper: BookKeeper
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const BookKeeper = (await ethers.getContractFactory("BookKeeper", deployer)) as BookKeeper__factory
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [])) as BookKeeper
  await bookKeeper.deployed()

  return { bookKeeper }
}

describe("BookKeeper", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer
  let bob: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string
  let bobAddress: string

  // Contracts
  let bookKeeper: BookKeeper
  let bookKeeperAsAlice: BookKeeper
  let bookKeeperAsBob: BookKeeper

  beforeEach(async () => {
    ;({ bookKeeper } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
    ])

    bookKeeperAsAlice = BookKeeper__factory.connect(bookKeeper.address, alice) as BookKeeper
    bookKeeperAsBob = BookKeeper__factory.connect(bookKeeper.address, bob) as BookKeeper
  })

  describe("#init", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(bookKeeperAsAlice.init(formatBytes32String("BNB"))).to.be.revertedWith("BookKeeper/not-authorized")
      })
    })
    context("when the caller is the owner", async () => {
      context("when initialize BNB collateral pool", async () => {
        it("should be success", async () => {
          await bookKeeper.init(formatBytes32String("BNB"))
          const pool = await bookKeeper.collateralPools(formatBytes32String("BNB"))
          expect(pool.debtAccumulatedRate).equal(WeiPerRay)
        })
      })

      context("when collateral pool already init", async () => {
        it("should be revert", async () => {
          // first initialize BNB colleteral pool
          await bookKeeper.init(formatBytes32String("BNB"))
          // second initialize BNB colleteral pool
          await expect(bookKeeper.init(formatBytes32String("BNB"))).to.be.revertedWith(
            "BookKeeper/collateral-pool-already-init"
          )
        })
      })
    })
  })

  describe("#addCollateral", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          bookKeeperAsAlice.addCollateral(formatBytes32String("BNB"), deployerAddress, WeiPerWad)
        ).to.be.revertedWith("BookKeeper/not-authorized")
      })
    })
    context("when the caller is the owner", async () => {
      context("when collateral to add is positive", () => {
        it("should be able to call addCollateral", async () => {
          // init BNB collateral pool
          await bookKeeper.init(formatBytes32String("BNB"))

          const collateralTokenBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), deployerAddress)
          expect(collateralTokenBefore).to.be.equal(0)

          await bookKeeper.addCollateral(formatBytes32String("BNB"), deployerAddress, WeiPerWad)

          const collateralTokenAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), deployerAddress)
          expect(collateralTokenAfter).to.be.equal(WeiPerWad)
        })
      })

      context("when collateral to add is negative", () => {
        it("should be able to call addCollateral", async () => {
          // init BNB collateral pool
          await bookKeeper.init(formatBytes32String("BNB"))

          // add collateral 1 BNB
          await bookKeeper.addCollateral(formatBytes32String("BNB"), deployerAddress, WeiPerWad)

          const collateralTokenBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), deployerAddress)
          expect(collateralTokenBefore).to.be.equal(WeiPerWad)

          // add collateral -1 BNB
          await bookKeeper.addCollateral(formatBytes32String("BNB"), deployerAddress, WeiPerWad.mul(-1))

          const collateralTokenAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), deployerAddress)
          expect(collateralTokenAfter).to.be.equal(0)
        })
      })
    })
  })

  describe("#moveCollateral", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        // bob call move collateral from alice to bob
        await await expect(
          bookKeeperAsBob.moveCollateral(formatBytes32String("BNB"), aliceAddress, bobAddress, WeiPerWad)
        ).to.be.revertedWith("BookKeeper/not-allowed")
      })

      context("when alice allow bob to move collateral", () => {
        it("should be able to call moveCollateral", async () => {
          // add collateral 1 BNB to alice
          await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad)

          const collateralTokenAliceBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), aliceAddress)
          expect(collateralTokenAliceBefore).to.be.equal(WeiPerWad)
          const collateralTokenBobBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), bobAddress)
          expect(collateralTokenBobBefore).to.be.equal(0)

          // alice allow bob to move collateral
          await bookKeeperAsAlice.hope(bobAddress)

          // bob call move collateral from alice to bob
          await bookKeeperAsBob.moveCollateral(formatBytes32String("BNB"), aliceAddress, bobAddress, WeiPerWad)

          const collateralTokenAliceAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), aliceAddress)
          expect(collateralTokenAliceAfter).to.be.equal(0)
          const collateralTokenBobAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), bobAddress)
          expect(collateralTokenBobAfter).to.be.equal(WeiPerWad)
        })
      })
    })

    context("when the caller is the owner", () => {
      it("should be able to call moveCollateral", async () => {
        // init BNB collateral pool
        await bookKeeper.init(formatBytes32String("BNB"))

        // add collateral 1 BNB to alice
        await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad)

        const collateralTokenAliceBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), aliceAddress)
        expect(collateralTokenAliceBefore).to.be.equal(WeiPerWad)
        const collateralTokenBobBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), bobAddress)
        expect(collateralTokenBobBefore).to.be.equal(0)

        // move collateral 1 BNB from alice to bob
        await bookKeeperAsAlice.moveCollateral(formatBytes32String("BNB"), aliceAddress, bobAddress, WeiPerWad)

        const collateralTokenAliceAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), aliceAddress)
        expect(collateralTokenAliceAfter).to.be.equal(0)
        const collateralTokenBobAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), bobAddress)
        expect(collateralTokenBobAfter).to.be.equal(WeiPerWad)
      })
    })
  })

  describe("#adjustPosition", () => {
    context("when parameters are valid", () => {
      it("should be able to call adjustPosition", async () => {
        await bookKeeper.init(formatBytes32String("BNB"))
        await bookKeeper.addCollateral(formatBytes32String("BNB"), deployerAddress, WeiPerWad)

        const collateralTokenBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), deployerAddress)
        const positionBefore = await bookKeeper.positions(formatBytes32String("BNB"), deployerAddress)

        expect(collateralTokenBefore).to.be.equal(WeiPerWad)
        expect(positionBefore.lockedCollateral).to.be.equal(0)

        await bookKeeper.adjustPosition(
          formatBytes32String("BNB"),
          deployerAddress,
          deployerAddress,
          deployerAddress,
          WeiPerWad,
          0
        )

        const collateralTokenAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), deployerAddress)
        const positionAfter = await bookKeeper.positions(formatBytes32String("BNB"), deployerAddress)

        expect(collateralTokenAfter).to.be.equal(0)
        expect(positionAfter.lockedCollateral).to.be.equal(WeiPerWad)
        // expect()
      })
    })
  })
})
