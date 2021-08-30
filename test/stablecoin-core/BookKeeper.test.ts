import { ethers, upgrades, waffle } from "hardhat"
import { Signer } from "ethers"
import chai from "chai"
import { solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { BookKeeper__factory, BookKeeper } from "../../typechain"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../helper/unit"

chai.use(solidity)
const { expect } = chai
const { formatBytes32String } = ethers.utils

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
})
