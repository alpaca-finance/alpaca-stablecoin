import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { StairstepExponentialDecrease__factory, StairstepExponentialDecrease } from "../../../typechain"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"
import * as AssertHelpers from "../../helper/assert"

chai.use(solidity)
const { expect } = chai
const { parseEther, formatBytes32String } = ethers.utils

type fixture = {
  stairstepExponentialDecrease: StairstepExponentialDecrease
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy StairstepExponentialDecrease
  const StairstepExponentialDecrease = (await ethers.getContractFactory(
    "StairstepExponentialDecrease",
    deployer
  )) as StairstepExponentialDecrease__factory
  const stairstepExponentialDecrease = await StairstepExponentialDecrease.deploy()

  return { stairstepExponentialDecrease }
}

describe("StairstepExponentialDecrease", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer
  let bob: Signer
  let dev: Signer

  // Contracts
  let stairstepExponentialDecrease: StairstepExponentialDecrease

  beforeEach(async () => {
    ;({ stairstepExponentialDecrease } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
  })

  describe("#price()", () => {
    context("when starting price is 50 wad", () => {
      context("and cut% is 0%", () => {
        context("and step is 1", () => {
          context("at 0 second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(formatBytes32String("cut"), 0) // 100%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 0)
              expect(price).to.be.equal(WeiPerWad.mul(50))
            })
          })

          context("at 1st second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(formatBytes32String("cut"), 0) // 100%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 1)
              expect(price).to.be.equal(0)
            })
          })
        })
      })

      context("and cut% is 1%", () => {
        context("and step is 1", () => {
          context("at 0 second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.sub(parseEther("10000000"))) // 99%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 0)
              expect(price).to.be.equal(WeiPerWad.mul(50))
            })
          })

          context("at 1st second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.sub(parseEther("10000000"))) // 99%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 1)
              expect(price).to.be.equal(WeiPerWad.mul(495).div(10))
            })
          })

          context("at 2nd second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.sub(parseEther("10000000"))) // 99%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 2)
              expect(price).to.be.equal(WeiPerWad.mul(49005).div(1000))
            })
          })
        })
      })

      context("and cut% is 99%", () => {
        context("and step is 1", () => {
          context("at 0 second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("990000000"))
              ) // 1%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 0)
              expect(price).to.be.equal(WeiPerWad.mul(50))
            })
          })

          context("at 1st second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("990000000"))
              ) // 1%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 1)
              expect(price).to.be.equal(BigNumber.from("500000000000000000").toString())
            })
          })
        })
      })

      context("and cut% is 100%", () => {
        context("and step is 1", () => {
          context("at 0 second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("1000000000"))
              ) // 0%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 0)
              expect(price).to.be.equal(WeiPerWad.mul(50))
            })
          })

          context("at 1st second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("1000000000"))
              ) // 0%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 1)
              expect(price).to.be.equal(0)
            })
          })
        })
      })

      context("and cut% is 1.123456789%", () => {
        context("and step is 1", () => {
          context("at 1st second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("1123456789").div(100))
              ) // 98.876543211%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 1)
              expect(price).to.be.equal(BigNumber.from("49438271605500000000").toString())
            })
          })

          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("1123456789").div(100))
              ) // 98.876543211%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 60)
              expect(price).to.be.equal(BigNumber.from("25384375980898602842").toString())
            })
          })
        })

        context("and step is 5", () => {
          context("at 1st second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("1123456789").div(100))
              ) // 98.876543211%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 5)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 1)
              expect(price).to.be.equal(WeiPerWad.mul(50))
            })
          })

          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("1123456789").div(100))
              ) // 98.876543211%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 5)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 60)
              expect(price).to.be.equal(BigNumber.from("43660560004238132027").toString())
            })
          })
        })
      })

      context("and cut% is 2.123456789%", () => {
        context("and step is 1", () => {
          context("at 1st second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("2123456789").div(100))
              ) // 97.876543211%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 1)
              expect(price).to.be.equal(BigNumber.from("48938271605500000000").toString())
            })
          })

          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("2123456789").div(100))
              ) // 97.876543211%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 60)
              expect(price).to.be.equal(BigNumber.from("13793909126329075429").toString())
            })
          })
        })

        context("and step is 5", () => {
          context("at 1st second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("2123456789").div(100))
              ) // 97.876543211%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 5)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 1)
              expect(price).to.be.equal(WeiPerWad.mul(50))
            })
          })

          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("2123456789").div(100))
              ) // 97.876543211%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 5)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.mul(50), 60)
              expect(price).to.be.equal(BigNumber.from("38646794298032588404").toString())
            })
          })
        })
      })
    })

    context("when starting price is 0.0000000001 wad", () => {
      context("and cut% is 1.123456789%", () => {
        context("and step is 1", () => {
          context("at 1st second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("1123456789").div(100))
              ) // 98.876543211%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.div(1000000000), 1)
              expect(price).to.be.equal(BigNumber.from("988765432").toString())
            })
          })

          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("1123456789").div(100))
              ) // 98.876543211%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.div(1000000000), 60)
              expect(price).to.be.equal(BigNumber.from("507687519").toString())
            })
          })
        })
      })

      context("and cut% is 2.123456789%", () => {
        context("and step is 1", () => {
          context("at 1st second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("2123456789").div(100))
              ) // 97.876543211%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.div(1000000000), 1)
              expect(price).to.be.equal(BigNumber.from("978765432").toString())
            })
          })

          context("at 60th second", () => {
            it("should calculate the price correctly", async () => {
              await stairstepExponentialDecrease.file(
                formatBytes32String("cut"),
                WeiPerRay.sub(parseEther("2123456789").div(100))
              ) // 97.876543211%
              await stairstepExponentialDecrease.file(formatBytes32String("step"), 1)
              const price = await stairstepExponentialDecrease.price(WeiPerWad.div(1000000000), 60)
              expect(price).to.be.equal(BigNumber.from("275878182").toString())
            })
          })
        })
      })
    })
  })
})
