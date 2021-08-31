import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { ExponentialDecrease__factory, ExponentialDecrease } from "../../../typechain"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"
import * as AssertHelpers from "../../helper/assert"

chai.use(solidity)
const { expect } = chai
const { parseEther, formatBytes32String } = ethers.utils

type fixture = {
  exponentialDecrease: ExponentialDecrease
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy ExponentialDecrease
  const ExponentialDecrease = (await ethers.getContractFactory(
    "ExponentialDecrease",
    deployer
  )) as ExponentialDecrease__factory
  const exponentialDecrease = await ExponentialDecrease.deploy()

  return { exponentialDecrease }
}

describe("ExponentialDecrease", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer
  let bob: Signer
  let dev: Signer

  // Contracts
  let exponentialDecrease: ExponentialDecrease

  beforeEach(async () => {
    ;({ exponentialDecrease } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
  })

  describe("#price()", () => {
    context("when starting price is 50 wad", () => {
      context("and cut% is 0%", () => {
        context("at 0 second", () => {
          it("should calculate the price correctly", async () => {
            await exponentialDecrease.file(formatBytes32String("cut"), 0) // 100%
            const price = await exponentialDecrease.price(WeiPerWad.mul(50), 0)
            expect(price).to.be.equal(WeiPerWad.mul(50))
          })
        })

        context("at 1st second", () => {
          it("should calculate the price correctly", async () => {
            await exponentialDecrease.file(formatBytes32String("cut"), 0) // 100%
            const price = await exponentialDecrease.price(WeiPerWad.mul(50), 1)
            expect(price).to.be.equal(0)
          })
        })
      })

      context("and cut% is 1%", () => {
        context("at 0 second", () => {
          it("should calculate the price correctly", async () => {
            await exponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.sub(parseEther("10000000"))) // 99%
            const price = await exponentialDecrease.price(WeiPerWad.mul(50), 0)
            expect(price).to.be.equal(WeiPerWad.mul(50))
          })
        })

        context("at 1st second", () => {
          it("should calculate the price correctly", async () => {
            await exponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.sub(parseEther("10000000"))) // 99%
            const price = await exponentialDecrease.price(WeiPerWad.mul(50), 1)
            expect(price).to.be.equal(WeiPerWad.mul(495).div(10))
          })
        })

        context("at 2nd second", () => {
          it("should calculate the price correctly", async () => {
            await exponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.sub(parseEther("10000000"))) // 99%
            const price = await exponentialDecrease.price(WeiPerWad.mul(50), 2)
            expect(price).to.be.equal(WeiPerWad.mul(49005).div(1000))
          })
        })
      })

      context("and cut% is 100%", () => {
        context("at 0 second", () => {
          it("should calculate the price correctly", async () => {
            await exponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.sub(parseEther("1000000000"))) // 100%
            const price = await exponentialDecrease.price(WeiPerWad.mul(50), 0)
            expect(price).to.be.equal(WeiPerWad.mul(50))
          })
        })

        context("at 1st second", () => {
          it("should calculate the price correctly", async () => {
            await exponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.sub(parseEther("1000000000"))) // 100%
            const price = await exponentialDecrease.price(WeiPerWad.mul(50), 1)
            expect(price).to.be.equal(0)
          })
        })
      })

      context("and cut% is 1.123456789%", () => {
        context("and decrease every second", () => {
          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await exponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("1123456789").div(100))
              )
              let price: BigNumber = WeiPerWad.mul(50)
              for (let second = 0; second < 60; second++) {
                price = await exponentialDecrease.price(price, 1)
              }
              AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("25384375980898602822").toString())
            })
          })
        })

        context("and decrease every 5th second", () => {
          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await exponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("1123456789").div(100))
              )
              let price: BigNumber = WeiPerWad.mul(50)
              for (let second = 0; second < 60; second += 5) {
                price = await exponentialDecrease.price(price, 1)
              }
              AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("43660560004238132022").toString())
            })
          })
        })
      })

      context("and cut% is 2.123456789%", () => {
        context("and decrease every second", () => {
          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await exponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("2123456789").div(100))
              )
              let price: BigNumber = WeiPerWad.mul(50)
              for (let second = 0; second < 60; second++) {
                price = await exponentialDecrease.price(price, 1)
              }
              AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("13793909126329075412").toString())
            })
          })
        })

        context("and decrease every 5th second", () => {
          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await exponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("2123456789").div(100))
              )
              let price: BigNumber = WeiPerWad.mul(50)
              for (let second = 0; second < 60; second += 5) {
                price = await exponentialDecrease.price(price, 1)
              }
              AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("38646794298032588398").toString())
            })
          })
        })
      })
    })

    context("when starting price is 0.0000000001 wad", () => {
      context("and cut% is 1.123456789%", () => {
        context("and decrease every second", () => {
          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await exponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("1123456789").div(100))
              )
              let price: BigNumber = WeiPerWad.div(1000000000)
              for (let second = 0; second < 60; second++) {
                price = await exponentialDecrease.price(price, 1)
              }
              AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("507687497").toString())
            })
          })
        })

        context("and decrease every 5th second", () => {
          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await exponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("1123456789").div(100))
              )
              let price: BigNumber = WeiPerWad.div(1000000000)
              for (let second = 0; second < 60; second += 5) {
                price = await exponentialDecrease.price(price, 1)
              }
              AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("873211194").toString())
            })
          })
        })
      })

      context("and cut% is 2.123456789%", () => {
        context("and decrease every second", () => {
          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await exponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("2123456789").div(100))
              )
              let price: BigNumber = WeiPerWad.div(1000000000)
              for (let second = 0; second < 60; second++) {
                price = await exponentialDecrease.price(price, 1)
              }
              AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("275878167").toString())
            })
          })
        })

        context("and decrease every 5th second", () => {
          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await exponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("2123456789").div(100))
              )
              let price: BigNumber = WeiPerWad.div(1000000000)
              for (let second = 0; second < 60; second += 5) {
                price = await exponentialDecrease.price(price, 1)
              }
              AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("772935882").toString())
            })
          })
        })
      })
    })
  })
})
