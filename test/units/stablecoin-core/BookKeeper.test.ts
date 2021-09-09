import { ethers, upgrades, waffle } from "hardhat"
import { Signer } from "ethers"
import chai from "chai"
import { solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { BookKeeper__factory, BookKeeper } from "../../../typechain"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"

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
      context("when alice doesn't have enough collateral", () => {
        it("shold be revert", async () => {
          // alice call move collateral from alice to bob
          await expect(
            bookKeeperAsAlice.moveCollateral(formatBytes32String("BNB"), aliceAddress, bobAddress, WeiPerWad)
          ).to.be.reverted
        })
      })
      context("when alice has enough collateral", () => {
        it("should be able to call moveCollateral", async () => {
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
  })

  describe("#moveStablecoin", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        // bob call move stablecoin from alice to bob
        await await expect(bookKeeperAsBob.moveStablecoin(aliceAddress, bobAddress, WeiPerRad)).to.be.revertedWith(
          "BookKeeper/not-allowed"
        )
      })

      context("when alice allow bob to move collateral", () => {
        it("should be able to call moveStablecoin", async () => {
          // mint 1 rad to alice
          await bookKeeper.mintUnbackedStablecoin(deployerAddress, aliceAddress, WeiPerRad)

          const stablecoinAliceBefore = await bookKeeper.stablecoin(aliceAddress)
          expect(stablecoinAliceBefore).to.be.equal(WeiPerRad)
          const stablecoinBobBefore = await bookKeeper.stablecoin(bobAddress)
          expect(stablecoinBobBefore).to.be.equal(0)

          // alice allow bob to move stablecoin
          await bookKeeperAsAlice.hope(bobAddress)

          // bob call move stablecoin from alice to bob
          await bookKeeperAsBob.moveStablecoin(aliceAddress, bobAddress, WeiPerRad)

          const stablecoinAliceAfter = await bookKeeper.stablecoin(aliceAddress)
          expect(stablecoinAliceAfter).to.be.equal(0)
          const stablecoinBobAfter = await bookKeeper.stablecoin(bobAddress)
          expect(stablecoinBobAfter).to.be.equal(WeiPerRad)
        })
      })
    })

    context("when the caller is the owner", () => {
      context("when alice doesn't have enough stablecoin", () => {
        it("shold be revert", async () => {
          // alice call move stablecoin from alice to bob
          await expect(bookKeeperAsAlice.moveStablecoin(aliceAddress, bobAddress, WeiPerRad)).to.be.reverted
        })
      })
      context("when alice has enough stablecoin", () => {
        it("should be able to call moveStablecoin", async () => {
          // mint 1 rad to alice
          await bookKeeper.mintUnbackedStablecoin(deployerAddress, aliceAddress, WeiPerRad)

          const stablecoinAliceBefore = await bookKeeper.stablecoin(aliceAddress)
          expect(stablecoinAliceBefore).to.be.equal(WeiPerRad)
          const stablecoinBobBefore = await bookKeeper.stablecoin(bobAddress)
          expect(stablecoinBobBefore).to.be.equal(0)

          // alice call move stablecoin from alice to bob
          await bookKeeperAsAlice.moveStablecoin(aliceAddress, bobAddress, WeiPerRad)

          const stablecoinAliceAfter = await bookKeeper.stablecoin(aliceAddress)
          expect(stablecoinAliceAfter).to.be.equal(0)
          const stablecoinBobAfter = await bookKeeper.stablecoin(bobAddress)
          expect(stablecoinBobAfter).to.be.equal(WeiPerRad)
        })
      })
    })
  })

  describe("#adjustPosition", () => {
    context("when bookkeeper does not live", () => {
      it("should be revert", async () => {
        bookKeeper.cage()

        await expect(
          bookKeeper.adjustPosition(
            formatBytes32String("BNB"),
            deployerAddress,
            deployerAddress,
            deployerAddress,
            WeiPerWad,
            0
          )
        ).to.be.revertedWith("BookKeeper/not-live")
      })
    })

    context("when collateral pool not init", () => {
      it("should be revert", async () => {
        await expect(
          bookKeeper.adjustPosition(
            formatBytes32String("BNB"),
            deployerAddress,
            deployerAddress,
            deployerAddress,
            WeiPerWad,
            0
          )
        ).to.be.revertedWith("BookKeeper/collateralPool-not-init")
      })
    })

    context("when call adjustPosition(lock, free)", () => {
      context("when call adjustPosition(lock)", () => {
        context("when alice call but bob is collateral owner", () => {
          it("should be revert", async () => {
            // initialize BNB colleteral pool
            await bookKeeper.init(formatBytes32String("BNB"))

            await expect(
              bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                bobAddress,
                aliceAddress,
                WeiPerWad.mul(10),
                0
              )
            ).to.be.revertedWith("BookKeeper/not-allowed-v")
          })
          context("when bob allow alice to move collateral", () => {
            context("when bob doesn't have enough collateral", () => {
              it("should be revert", async () => {
                // initialize BNB colleteral pool
                await bookKeeper.init(formatBytes32String("BNB"))

                // alice allow bob to move stablecoin
                await bookKeeperAsBob.hope(aliceAddress)

                await expect(
                  bookKeeperAsAlice.adjustPosition(
                    formatBytes32String("BNB"),
                    aliceAddress,
                    bobAddress,
                    aliceAddress,
                    WeiPerWad.mul(10),
                    0
                  )
                ).to.be.reverted
              })
            })

            context("when bob has enough collateral", () => {
              it("should be able to call adjustPosition(lock)", async () => {
                // initialize BNB colleteral pool
                await bookKeeper.init(formatBytes32String("BNB"))

                // add collateral to bob 10 BNB
                await bookKeeper.addCollateral(formatBytes32String("BNB"), bobAddress, WeiPerWad.mul(10))

                // alice allow bob to move stablecoin
                await bookKeeperAsBob.hope(aliceAddress)

                const positionBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
                expect(positionBefore.lockedCollateral).to.be.equal(0)

                // lock collateral
                await bookKeeperAsAlice.adjustPosition(
                  formatBytes32String("BNB"),
                  aliceAddress,
                  bobAddress,
                  aliceAddress,
                  WeiPerWad.mul(10),
                  0
                )

                const positionAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
                expect(positionAfter.lockedCollateral).to.be.equal(WeiPerWad.mul(10))
              })
            })
          })
        })
        context("when alice call and alice is collateral owner", () => {
          context("when alice doesn't have enough collateral", () => {
            it("should be revert", async () => {
              // initialize BNB colleteral pool
              await bookKeeper.init(formatBytes32String("BNB"))

              await expect(
                bookKeeperAsAlice.adjustPosition(
                  formatBytes32String("BNB"),
                  aliceAddress,
                  aliceAddress,
                  aliceAddress,
                  WeiPerWad.mul(10),
                  0
                )
              ).to.be.reverted
            })
          })

          context("when alice has enough collateral", () => {
            it("should be able to call adjustPosition(lock)", async () => {
              // initialize BNB colleteral pool
              await bookKeeper.init(formatBytes32String("BNB"))

              // add collateral to bob 10 BNB
              await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

              const positionBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
              expect(positionBefore.lockedCollateral).to.be.equal(0)

              // lock collateral
              await bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                aliceAddress,
                aliceAddress,
                WeiPerWad.mul(10),
                0
              )

              const positionAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
              expect(positionAfter.lockedCollateral).to.be.equal(WeiPerWad.mul(10))
            })
          })
        })
      })
      context("when call adjustPosition(free)", () => {
        context("when alice call and alice is collateral owner", () => {
          context("when alice doesn't have enough lock collateral in position", () => {
            it("should be revert", async () => {
              // initialize BNB colleteral pool
              await bookKeeper.init(formatBytes32String("BNB"))

              // free collateral
              await expect(
                bookKeeperAsAlice.adjustPosition(
                  formatBytes32String("BNB"),
                  aliceAddress,
                  aliceAddress,
                  aliceAddress,
                  WeiPerWad.mul(-1),
                  0
                )
              ).to.be.reverted
            })
          })
          context("when alice has enough lock collateral in position", () => {
            it("should be able to call adjustPosition(free)", async () => {
              // initialize BNB colleteral pool
              await bookKeeper.init(formatBytes32String("BNB"))

              // add collateral to alice 10 BNB
              await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

              // lock collateral
              await bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                aliceAddress,
                aliceAddress,
                WeiPerWad.mul(10),
                0
              )

              const positionAliceBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
              expect(positionAliceBefore.lockedCollateral).to.be.equal(WeiPerWad.mul(10))
              const collateralTokenAliceBefore = await bookKeeper.collateralToken(
                formatBytes32String("BNB"),
                aliceAddress
              )
              expect(collateralTokenAliceBefore).to.be.equal(0)

              // free collateral
              await bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                aliceAddress,
                aliceAddress,
                WeiPerWad.mul(-1),
                0
              )

              const positionAliceAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
              expect(positionAliceAfter.lockedCollateral).to.be.equal(WeiPerWad.mul(9))
              const collateralTokenAliceAfter = await bookKeeper.collateralToken(
                formatBytes32String("BNB"),
                aliceAddress
              )
              expect(collateralTokenAliceAfter).to.be.equal(WeiPerWad)
            })
          })
        })
        context("when alice call but bob is collateral owner", () => {
          context("when alice doesn't have enough lock collateral in position", () => {
            it("should be revert", async () => {
              // initialize BNB colleteral pool
              await bookKeeper.init(formatBytes32String("BNB"))

              // free collateral
              await expect(
                bookKeeperAsAlice.adjustPosition(
                  formatBytes32String("BNB"),
                  aliceAddress,
                  bobAddress,
                  aliceAddress,
                  WeiPerWad.mul(-1),
                  0
                )
              ).to.be.reverted
            })
          })
          context("when alice has enough lock collateral in position", () => {
            it("should be able to call adjustPosition(free)", async () => {
              // initialize BNB colleteral pool
              await bookKeeper.init(formatBytes32String("BNB"))

              // add collateral to alice 10 BNB
              await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

              // lock collateral
              await bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                aliceAddress,
                aliceAddress,
                WeiPerWad.mul(10),
                0
              )

              const positionAliceBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
              expect(positionAliceBefore.lockedCollateral).to.be.equal(WeiPerWad.mul(10))
              const collateralTokenBobBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), bobAddress)
              expect(collateralTokenBobBefore).to.be.equal(0)

              // free collateral
              await bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                bobAddress,
                aliceAddress,
                WeiPerWad.mul(-1),
                0
              )

              const positionAliceAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
              expect(positionAliceAfter.lockedCollateral).to.be.equal(WeiPerWad.mul(9))
              const collateralTokenBobAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), bobAddress)
              expect(collateralTokenBobAfter).to.be.equal(WeiPerWad)
            })
          })
        })
      })
    })

    context("when call adjustPosition(draw, wipe)", () => {
      context("when debt ceilings are exceeded", () => {
        context("when pool debt ceiling are exceeded", () => {
          it("should be revert", async () => {
            // initialize BNB colleteral pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 1 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad)

            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            await expect(
              bookKeeper.adjustPosition(
                formatBytes32String("BNB"),
                deployerAddress,
                deployerAddress,
                deployerAddress,
                0,
                WeiPerWad.mul(10)
              )
            ).to.be.revertedWith("BookKeeper/ceiling-exceeded")
          })
        })
        context("when total debt ceiling are exceeded", () => {
          it("should be revert", async () => {
            // initialize BNB colleteral pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 10 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))

            // set total debt ceiling 1 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad)

            await expect(
              bookKeeper.adjustPosition(
                formatBytes32String("BNB"),
                deployerAddress,
                deployerAddress,
                deployerAddress,
                0,
                WeiPerWad.mul(10)
              )
            ).to.be.revertedWith("BookKeeper/ceiling-exceeded")
          })
        })
      })
      context("when position is not safe", () => {
        it("should be revert", async () => {
          // initialize BNB colleteral pool
          await bookKeeper.init(formatBytes32String("BNB"))
          // set pool debt ceiling 10 rad
          await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
          // set price with safety margin 1 ray
          await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)

          // set total debt ceiling 10 rad
          await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

          await expect(
            bookKeeper.adjustPosition(
              formatBytes32String("BNB"),
              deployerAddress,
              deployerAddress,
              deployerAddress,
              0,
              WeiPerWad.mul(10)
            )
          ).to.be.revertedWith("BookKeeper/not-safe")
        })
      })
      context("when call adjustPosition(draw)", () => {
        context("when alice call but bob is position owner", () => {
          it("should be revert", async () => {
            // initialize BNB colleteral pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 10 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)

            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), bobAddress, WeiPerWad.mul(10))

            // bob lock collateral 10 BNB
            await bookKeeperAsBob.adjustPosition(
              formatBytes32String("BNB"),
              bobAddress,
              bobAddress,
              bobAddress,
              WeiPerWad.mul(10),
              0
            )

            await expect(
              bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                bobAddress,
                bobAddress,
                bobAddress,
                0,
                WeiPerWad.mul(10)
              )
            ).to.be.revertedWith("BookKeeper/not-allowed-u")
          })
          context("when bob allow alice to manage position", () => {
            it("should be able to call adjustPosition(draw)", async () => {
              // initialize BNB colleteral pool
              await bookKeeper.init(formatBytes32String("BNB"))
              // set pool debt ceiling 10 rad
              await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
              // set price with safety margin 1 ray
              await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)

              // set total debt ceiling 10 rad
              await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

              // add collateral to 10 BNB
              await bookKeeper.addCollateral(formatBytes32String("BNB"), bobAddress, WeiPerWad.mul(10))

              // bob lock collateral 10 BNB
              await bookKeeperAsBob.adjustPosition(
                formatBytes32String("BNB"),
                bobAddress,
                bobAddress,
                bobAddress,
                WeiPerWad.mul(10),
                0
              )

              // bob allow alice
              await bookKeeperAsBob.hope(aliceAddress)

              const positionBobBefore = await bookKeeper.positions(formatBytes32String("BNB"), bobAddress)
              expect(positionBobBefore.debtShare).to.be.equal(0)
              const BNBPoolBefore = await bookKeeper.collateralPools(formatBytes32String("BNB"))
              expect(BNBPoolBefore.totalDebtShare).to.be.equal(0)
              const stablecoinAliceBefore = await bookKeeper.stablecoin(aliceAddress)
              expect(stablecoinAliceBefore).to.be.equal(0)

              // alice draw
              await bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                bobAddress,
                bobAddress,
                aliceAddress,
                0,
                WeiPerWad.mul(10)
              )

              const positionBobAfter = await bookKeeper.positions(formatBytes32String("BNB"), bobAddress)
              expect(positionBobAfter.debtShare).to.be.equal(WeiPerWad.mul(10))
              const BNBPoolAfter = await bookKeeper.collateralPools(formatBytes32String("BNB"))
              expect(BNBPoolAfter.totalDebtShare).to.be.equal(WeiPerWad.mul(10))
              const stablecoinAliceAfter = await bookKeeper.stablecoin(aliceAddress)
              expect(stablecoinAliceAfter).to.be.equal(WeiPerRad.mul(10))
            })
          })
        })
        context("when alice call and alice is position owner", () => {
          it("should be able to call adjustPosition(draw)", async () => {
            // initialize BNB colleteral pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 10 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)

            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              0
            )

            const positionaliceBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionaliceBefore.debtShare).to.be.equal(0)
            const BNBPoolBefore = await bookKeeper.collateralPools(formatBytes32String("BNB"))
            expect(BNBPoolBefore.totalDebtShare).to.be.equal(0)
            const stablecoinAliceBefore = await bookKeeper.stablecoin(aliceAddress)
            expect(stablecoinAliceBefore).to.be.equal(0)

            // alice draw
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              0,
              WeiPerWad.mul(10)
            )

            const positionaliceAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionaliceAfter.debtShare).to.be.equal(WeiPerWad.mul(10))
            const BNBPoolAfter = await bookKeeper.collateralPools(formatBytes32String("BNB"))
            expect(BNBPoolAfter.totalDebtShare).to.be.equal(WeiPerWad.mul(10))
            const stablecoinAliceAfter = await bookKeeper.stablecoin(aliceAddress)
            expect(stablecoinAliceAfter).to.be.equal(WeiPerRad.mul(10))
          })
        })
        context("when position debt value < debt floor", () => {
          it("should be revert", async () => {
            // initialize BNB colleteral pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 10 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 20 rad
            await bookKeeper.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(20))

            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              0
            )

            // alice draw
            await expect(
              bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                aliceAddress,
                aliceAddress,
                0,
                WeiPerWad.mul(10)
              )
            ).to.be.revertedWith("BookKeeper/debtFloor")
          })
        })
      })
      context("when call adjustPosition(wipe)", () => {
        context("when alice call and alice is position owner", () => {
          it("should be able to call adjustPosition(wipe)", async () => {
            // initialize BNB colleteral pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 10 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)

            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              0
            )

            // alice draw
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              0,
              WeiPerWad.mul(10)
            )

            const positionaliceBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionaliceBefore.debtShare).to.be.equal(WeiPerWad.mul(10))
            const BNBPoolBefore = await bookKeeper.collateralPools(formatBytes32String("BNB"))
            expect(BNBPoolBefore.totalDebtShare).to.be.equal(WeiPerWad.mul(10))
            const stablecoinAliceBefore = await bookKeeper.stablecoin(aliceAddress)
            expect(stablecoinAliceBefore).to.be.equal(WeiPerRad.mul(10))

            // alice wipe
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              0,
              WeiPerWad.mul(-10)
            )

            const positionaliceAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionaliceAfter.debtShare).to.be.equal(0)
            const BNBPoolAfter = await bookKeeper.collateralPools(formatBytes32String("BNB"))
            expect(BNBPoolAfter.totalDebtShare).to.be.equal(0)
            const stablecoinAliceAfter = await bookKeeper.stablecoin(aliceAddress)
            expect(stablecoinAliceAfter).to.be.equal(0)
          })
        })
        context("when position debt value < debt floor", () => {
          it("should be revert", async () => {
            // initialize BNB colleteral pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 10 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 5 rad
            await bookKeeper.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(5))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              0
            )

            // alice draw
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              0,
              WeiPerWad.mul(10)
            )

            // alice wipe
            await expect(
              bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                aliceAddress,
                aliceAddress,
                0,
                WeiPerWad.mul(-9)
              )
            ).to.be.revertedWith("BookKeeper/debtFloor")
          })
        })
      })
    })
  })

  describe("#movePosition", () => {
    context("when alice move position to bob", () => {
      context("when alice and bob don't allow anyone else to manage the position", () => {
        it("should be revert", async () => {
          // initialize BNB colleteral pool
          await bookKeeper.init(formatBytes32String("BNB"))
          // set pool debt ceiling 10 rad
          await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
          // set price with safety margin 1 ray
          await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
          // set position debt floor 1 rad
          await bookKeeper.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
          // set total debt ceiling 10 rad
          await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

          // add collateral to 10 BNB
          await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

          // alice lock collateral 10 BNB
          await bookKeeperAsAlice.adjustPosition(
            formatBytes32String("BNB"),
            aliceAddress,
            aliceAddress,
            aliceAddress,
            WeiPerWad.mul(10),
            WeiPerWad.mul(2)
          )

          await expect(
            bookKeeperAsAlice.movePosition(
              formatBytes32String("BNB"),
              aliceAddress,
              bobAddress,
              WeiPerWad.mul(5),
              WeiPerWad.mul(1)
            )
          ).to.be.revertedWith("BookKeeper/not-allowed")
        })
      })
      context("when bob allow alice to manage a position", () => {
        context("when after moving alice position was not safe", () => {
          it("should be revert", async () => {
            // initialize BNB colleteral pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 10 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await bookKeeper.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              WeiPerWad.mul(2)
            )

            // bob allow alice to manage a position
            await bookKeeperAsBob.hope(aliceAddress)

            await expect(
              bookKeeperAsAlice.movePosition(
                formatBytes32String("BNB"),
                aliceAddress,
                bobAddress,
                WeiPerWad.mul(10),
                WeiPerWad.mul(0)
              )
            ).to.be.revertedWith("BookKeeper/not-safe-src")
          })
        })
        context("when after moving bob position was not safe", () => {
          it("should be revert", async () => {
            // initialize BNB colleteral pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 10 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await bookKeeper.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              WeiPerWad.mul(2)
            )

            // bob allow alice to manage a position
            await bookKeeperAsBob.hope(aliceAddress)

            await expect(
              bookKeeperAsAlice.movePosition(
                formatBytes32String("BNB"),
                aliceAddress,
                bobAddress,
                WeiPerWad.mul(0),
                WeiPerWad.mul(2)
              )
            ).to.be.revertedWith("BookKeeper/not-safe-dst")
          })
        })
        context("when after moving alice position was not enough debt", () => {
          it("should be revert", async () => {
            // initialize BNB colleteral pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 10 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await bookKeeper.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(2))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              WeiPerWad.mul(2)
            )

            // bob allow alice to manage a position
            await bookKeeperAsBob.hope(aliceAddress)

            await expect(
              bookKeeperAsAlice.movePosition(
                formatBytes32String("BNB"),
                aliceAddress,
                bobAddress,
                WeiPerWad.mul(5),
                WeiPerWad.mul(1)
              )
            ).to.be.revertedWith("BookKeeper/debtFloor-src")
          })
        })
        context("when after moving bob position was not enough debt", () => {
          it("should be revert", async () => {
            // initialize BNB colleteral pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 10 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await bookKeeper.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(2))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              WeiPerWad.mul(3)
            )

            // bob allow alice to manage a position
            await bookKeeperAsBob.hope(aliceAddress)

            await expect(
              bookKeeperAsAlice.movePosition(
                formatBytes32String("BNB"),
                aliceAddress,
                bobAddress,
                WeiPerWad.mul(5),
                WeiPerWad.mul(1)
              )
            ).to.be.revertedWith("BookKeeper/debtFloor-dst")
          })
        })
        context("when alice and bob positions are safe", () => {
          it("should be able to call movePosition", async () => {
            // initialize BNB colleteral pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 10 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await bookKeeper.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              WeiPerWad.mul(2)
            )

            // bob allow alice to manage a position
            await bookKeeperAsBob.hope(aliceAddress)

            const positionAliceBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionAliceBefore.lockedCollateral).to.be.equal(WeiPerWad.mul(10))
            expect(positionAliceBefore.debtShare).to.be.equal(WeiPerWad.mul(2))

            const positionBobBefore = await bookKeeper.positions(formatBytes32String("BNB"), bobAddress)
            expect(positionBobBefore.lockedCollateral).to.be.equal(0)
            expect(positionBobBefore.debtShare).to.be.equal(0)

            await bookKeeperAsAlice.movePosition(
              formatBytes32String("BNB"),
              aliceAddress,
              bobAddress,
              WeiPerWad.mul(5),
              WeiPerWad.mul(1)
            )

            const positionAliceAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionAliceAfter.lockedCollateral).to.be.equal(WeiPerWad.mul(5))
            expect(positionAliceAfter.debtShare).to.be.equal(WeiPerWad.mul(1))

            const positionBobAfter = await bookKeeper.positions(formatBytes32String("BNB"), bobAddress)
            expect(positionBobAfter.lockedCollateral).to.be.equal(WeiPerWad.mul(5))
            expect(positionBobAfter.debtShare).to.be.equal(WeiPerWad.mul(1))
          })
        })
      })
    })
  })

  describe("#confiscatePosition", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          bookKeeperAsAlice.confiscatePosition(
            formatBytes32String("BNB"),
            aliceAddress,
            deployerAddress,
            deployerAddress,
            WeiPerWad.mul(-1),
            WeiPerWad.mul(-1)
          )
        ).to.be.revertedWith("BookKeeper/not-authorized")
      })
    })
    context("when the caller is the owner", async () => {
      context("when start liquidation", () => {
        context("when liquidating all in position", () => {
          it("should be able to call confiscatePosition", async () => {
            // init BNB pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 10 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await bookKeeper.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
            // set total debt ceiling 1 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad)

            // add collateral to 1 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad)
            // adjust position
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad,
              WeiPerWad
            )

            const positionBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionBefore.lockedCollateral).to.be.equal(WeiPerWad)
            expect(positionBefore.debtShare).to.be.equal(WeiPerWad)
            const collateralPoolBefore = await bookKeeper.collateralPools(formatBytes32String("BNB"))
            expect(collateralPoolBefore.totalDebtShare).to.be.equal(WeiPerWad)
            const collateralTokenCreditorBefore = await bookKeeper.collateralToken(
              formatBytes32String("BNB"),
              deployerAddress
            )
            expect(collateralTokenCreditorBefore).to.be.equal(0)
            const systemBadDebtDebtorBefore = await bookKeeper.systemBadDebt(deployerAddress)
            expect(systemBadDebtDebtorBefore).to.be.equal(0)
            const totalUnbackedStablecoinBefore = await bookKeeper.totalUnbackedStablecoin()
            expect(totalUnbackedStablecoinBefore).to.be.equal(0)

            // confiscate position
            await bookKeeper.confiscatePosition(
              formatBytes32String("BNB"),
              aliceAddress,
              deployerAddress,
              deployerAddress,
              WeiPerWad.mul(-1),
              WeiPerWad.mul(-1)
            )

            const positionAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionAfter.lockedCollateral).to.be.equal(0)
            expect(positionAfter.debtShare).to.be.equal(0)
            const collateralPoolAfter = await bookKeeper.collateralPools(formatBytes32String("BNB"))
            expect(collateralPoolAfter.totalDebtShare).to.be.equal(0)
            const collateralTokenCreditorAfter = await bookKeeper.collateralToken(
              formatBytes32String("BNB"),
              deployerAddress
            )
            expect(collateralTokenCreditorAfter).to.be.equal(WeiPerWad)
            const systemBadDebtDebtorAfter = await bookKeeper.systemBadDebt(deployerAddress)
            expect(systemBadDebtDebtorAfter).to.be.equal(WeiPerRad)
            const totalUnbackedStablecoinAfter = await bookKeeper.totalUnbackedStablecoin()
            expect(totalUnbackedStablecoinAfter).to.be.equal(WeiPerRad)
          })
        })
        context("when liquidating some in position", () => {
          it("should be able to call confiscatePosition", async () => {
            // init BNB pool
            await bookKeeper.init(formatBytes32String("BNB"))
            // set pool debt ceiling 10 rad
            await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await bookKeeper.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 2 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(2))
            // adjust position
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(2),
              WeiPerWad.mul(2)
            )

            const positionBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionBefore.lockedCollateral).to.be.equal(WeiPerWad.mul(2))
            expect(positionBefore.debtShare).to.be.equal(WeiPerWad.mul(2))
            const collateralPoolBefore = await bookKeeper.collateralPools(formatBytes32String("BNB"))
            expect(collateralPoolBefore.totalDebtShare).to.be.equal(WeiPerWad.mul(2))
            const collateralTokenCreditorBefore = await bookKeeper.collateralToken(
              formatBytes32String("BNB"),
              deployerAddress
            )
            expect(collateralTokenCreditorBefore).to.be.equal(0)
            const systemBadDebtDebtorBefore = await bookKeeper.systemBadDebt(deployerAddress)
            expect(systemBadDebtDebtorBefore).to.be.equal(0)
            const totalUnbackedStablecoinBefore = await bookKeeper.totalUnbackedStablecoin()
            expect(totalUnbackedStablecoinBefore).to.be.equal(0)

            // confiscate position
            await bookKeeper.confiscatePosition(
              formatBytes32String("BNB"),
              aliceAddress,
              deployerAddress,
              deployerAddress,
              WeiPerWad.mul(-1),
              WeiPerWad.mul(-1)
            )

            const positionAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionAfter.lockedCollateral).to.be.equal(WeiPerWad)
            expect(positionAfter.debtShare).to.be.equal(WeiPerWad)
            const collateralPoolAfter = await bookKeeper.collateralPools(formatBytes32String("BNB"))
            expect(collateralPoolAfter.totalDebtShare).to.be.equal(WeiPerWad)
            const collateralTokenCreditorAfter = await bookKeeper.collateralToken(
              formatBytes32String("BNB"),
              deployerAddress
            )
            expect(collateralTokenCreditorAfter).to.be.equal(WeiPerWad)
            const systemBadDebtDebtorAfter = await bookKeeper.systemBadDebt(deployerAddress)
            expect(systemBadDebtDebtorAfter).to.be.equal(WeiPerRad)
            const totalUnbackedStablecoinAfter = await bookKeeper.totalUnbackedStablecoin()
            expect(totalUnbackedStablecoinAfter).to.be.equal(WeiPerRad)
          })
        })
      })
    })
  })

  describe("#mintUnbackedStablecoin", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          bookKeeperAsAlice.mintUnbackedStablecoin(deployerAddress, aliceAddress, WeiPerRad)
        ).to.be.revertedWith("BookKeeper/not-authorized")
      })
    })
    context("when the caller is the owner", async () => {
      context("when mint unbacked stable coin", () => {
        it("should be able to call mintUnbackedStablecoin", async () => {
          const systemBadDebtBefore = await bookKeeper.systemBadDebt(deployerAddress)
          expect(systemBadDebtBefore).to.be.equal(0)
          const stablecoinAliceBefore = await bookKeeper.stablecoin(aliceAddress)
          expect(stablecoinAliceBefore).to.be.equal(0)
          const totalUnbackedStablecoinBefore = await bookKeeper.totalUnbackedStablecoin()
          expect(totalUnbackedStablecoinBefore).to.be.equal(0)
          const totalStablecoinIssuedBefore = await bookKeeper.totalStablecoinIssued()
          expect(totalStablecoinIssuedBefore).to.be.equal(0)

          //  mint 1 rad to alice
          await bookKeeper.mintUnbackedStablecoin(deployerAddress, aliceAddress, WeiPerRad)

          const systemBadDebtAfter = await bookKeeper.systemBadDebt(deployerAddress)
          expect(systemBadDebtAfter).to.be.equal(WeiPerRad)
          const stablecoinAliceAfter = await bookKeeper.stablecoin(aliceAddress)
          expect(stablecoinAliceAfter).to.be.equal(WeiPerRad)
          const totalUnbackedStablecoinAfter = await bookKeeper.totalUnbackedStablecoin()
          expect(totalUnbackedStablecoinAfter).to.be.equal(WeiPerRad)
          const totalStablecoinIssuedAfter = await bookKeeper.totalStablecoinIssued()
          expect(totalStablecoinIssuedAfter).to.be.equal(WeiPerRad)
        })
      })
    })
  })

  describe("#settleSystemBadDebt", () => {
    context("when settle system bad debt", () => {
      it("should be able to call settleSystemBadDebt", async () => {
        //  mint 1 rad to deployer
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, deployerAddress, WeiPerRad)

        const systemBadDebtBefore = await bookKeeper.systemBadDebt(deployerAddress)
        expect(systemBadDebtBefore).to.be.equal(WeiPerRad)
        const stablecoinDeployerBefore = await bookKeeper.stablecoin(deployerAddress)
        expect(stablecoinDeployerBefore).to.be.equal(WeiPerRad)
        const totalUnbackedStablecoinBefore = await bookKeeper.totalUnbackedStablecoin()
        expect(totalUnbackedStablecoinBefore).to.be.equal(WeiPerRad)
        const totalStablecoinIssuedBefore = await bookKeeper.totalStablecoinIssued()
        expect(totalStablecoinIssuedBefore).to.be.equal(WeiPerRad)

        // settle system bad debt 1 rad
        await bookKeeper.settleSystemBadDebt(WeiPerRad)

        const systemBadDebtAfter = await bookKeeper.systemBadDebt(deployerAddress)
        expect(systemBadDebtAfter).to.be.equal(0)
        const stablecoinDeployerAfter = await bookKeeper.stablecoin(deployerAddress)
        expect(stablecoinDeployerAfter).to.be.equal(0)
        const totalUnbackedStablecoinAfter = await bookKeeper.totalUnbackedStablecoin()
        expect(totalUnbackedStablecoinAfter).to.be.equal(0)
        const totalStablecoinIssuedAfter = await bookKeeper.totalStablecoinIssued()
        expect(totalStablecoinIssuedAfter).to.be.equal(0)
      })
    })
  })

  describe("#accrueStabilityFee", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          bookKeeperAsAlice.accrueStabilityFee(formatBytes32String("BNB"), deployerAddress, WeiPerRay)
        ).to.be.revertedWith("BookKeeper/not-authorized")
      })
    })
    context("when the caller is the owner", async () => {
      context("when bookkeeper does not live", () => {
        it("should be revert", async () => {
          bookKeeper.cage()

          await expect(
            bookKeeper.accrueStabilityFee(formatBytes32String("BNB"), deployerAddress, WeiPerRay)
          ).to.be.revertedWith("BookKeeper/not-live")
        })
      })
      context("when bookkeeper is live", () => {
        it("should be able to call accrueStabilityFee", async () => {
          // init BNB pool
          await bookKeeper.init(formatBytes32String("BNB"))
          // set pool debt ceiling 10 rad
          await bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
          // set price with safety margin 1 ray
          await bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
          // set position debt floor 1 rad
          await bookKeeper.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
          // set total debt ceiling 1 rad
          await bookKeeper.setTotalDebtCeiling(WeiPerRad)

          // add collateral to 1 BNB
          await bookKeeper.addCollateral(formatBytes32String("BNB"), deployerAddress, WeiPerWad)
          // adjust position
          await bookKeeper.adjustPosition(
            formatBytes32String("BNB"),
            deployerAddress,
            deployerAddress,
            deployerAddress,
            WeiPerWad,
            WeiPerWad
          )

          const poolBefore = await bookKeeper.collateralPools(formatBytes32String("BNB"))
          expect(poolBefore.debtAccumulatedRate).to.be.equal(WeiPerRay)
          const stablecoinDeployerBefore = await bookKeeper.stablecoin(deployerAddress)
          expect(stablecoinDeployerBefore).to.be.equal(WeiPerRad)
          const totalStablecoinIssuedBefore = await bookKeeper.totalStablecoinIssued()
          expect(totalStablecoinIssuedBefore).to.be.equal(WeiPerRad)

          await bookKeeper.accrueStabilityFee(formatBytes32String("BNB"), deployerAddress, WeiPerRay)

          const poolAfter = await bookKeeper.collateralPools(formatBytes32String("BNB"))
          expect(poolAfter.debtAccumulatedRate).to.be.equal(WeiPerRay.mul(2))
          const stablecoinDeployerAfter = await bookKeeper.stablecoin(deployerAddress)
          expect(stablecoinDeployerAfter).to.be.equal(WeiPerRad.mul(2))
          const totalStablecoinIssuedAfter = await bookKeeper.totalStablecoinIssued()
          expect(totalStablecoinIssuedAfter).to.be.equal(WeiPerRad.mul(2))
        })
      })
    })
  })

  describe("#setTotalDebtCeiling", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(bookKeeperAsAlice.setTotalDebtCeiling(WeiPerRad)).to.be.revertedWith("BookKeeper/not-authorized")
      })
    })
    context("when the caller is the owner", async () => {
      context("when bookkeeper does not live", () => {
        it("should be revert", async () => {
          bookKeeper.cage()

          await expect(bookKeeper.setTotalDebtCeiling(WeiPerRad)).to.be.revertedWith("BookKeeper/not-live")
        })
      })
      context("when bookkeeper is live", () => {
        it("should be able to call setTotalDebtCeiling", async () => {
          // init BNB pool
          await bookKeeper.init(formatBytes32String("BNB"))
          // set total debt ceiling 1 rad
          await expect(bookKeeper.setTotalDebtCeiling(WeiPerRad))
            .to.emit(bookKeeper, "SetTotalDebtCeiling")
            .withArgs(deployerAddress, WeiPerRad)
        })
      })
    })
  })

  describe("#setPriceWithSafetyMargin", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          bookKeeperAsAlice.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
        ).to.be.revertedWith("BookKeeper/not-authorized")
      })
    })
    context("when the caller is the owner", async () => {
      context("when bookkeeper does not live", () => {
        it("should be revert", async () => {
          bookKeeper.cage()

          await expect(bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)).to.be.revertedWith(
            "BookKeeper/not-live"
          )
        })
      })
      context("when bookkeeper is live", () => {
        it("should be able to call setPriceWithSafetyMargin", async () => {
          // init BNB pool
          await bookKeeper.init(formatBytes32String("BNB"))
          // set total debt ceiling 1 rad
          await expect(bookKeeper.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay))
            .to.emit(bookKeeper, "SetPriceWithSafetyMargin")
            .withArgs(deployerAddress, formatBytes32String("BNB"), WeiPerRay)
        })
      })
    })
  })

  describe("#setDebtCeiling", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(bookKeeperAsAlice.setDebtCeiling(formatBytes32String("BNB"), WeiPerRay)).to.be.revertedWith(
          "BookKeeper/not-authorized"
        )
      })
    })
    context("when the caller is the owner", async () => {
      context("when bookkeeper does not live", () => {
        it("should be revert", async () => {
          bookKeeper.cage()

          await expect(bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRay)).to.be.revertedWith(
            "BookKeeper/not-live"
          )
        })
      })
      context("when bookkeeper is live", () => {
        it("should be able to call setDebtCeiling", async () => {
          // init BNB pool
          await bookKeeper.init(formatBytes32String("BNB"))
          // set total debt ceiling 1 rad
          await expect(bookKeeper.setDebtCeiling(formatBytes32String("BNB"), WeiPerRay))
            .to.emit(bookKeeper, "SetDebtCeiling")
            .withArgs(deployerAddress, formatBytes32String("BNB"), WeiPerRay)
        })
      })
    })
  })

  describe("#setDebtFloor", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(bookKeeperAsAlice.setDebtFloor(formatBytes32String("BNB"), WeiPerRay)).to.be.revertedWith(
          "BookKeeper/not-authorized"
        )
      })
    })
    context("when the caller is the owner", async () => {
      context("when bookkeeper does not live", () => {
        it("should be revert", async () => {
          bookKeeper.cage()

          await expect(bookKeeper.setDebtFloor(formatBytes32String("BNB"), WeiPerRay)).to.be.revertedWith(
            "BookKeeper/not-live"
          )
        })
      })
      context("when bookkeeper is live", () => {
        it("should be able to call setDebtFloor", async () => {
          // init BNB pool
          await bookKeeper.init(formatBytes32String("BNB"))
          // set total debt ceiling 1 rad
          await expect(bookKeeper.setDebtFloor(formatBytes32String("BNB"), WeiPerRay))
            .to.emit(bookKeeper, "SetDebtFloor")
            .withArgs(deployerAddress, formatBytes32String("BNB"), WeiPerRay)
        })
      })
    })
  })
})
