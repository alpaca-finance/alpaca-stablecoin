import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import {
  BookKeeper__factory,
  CDPManager,
  CDPManager__factory,
  BookKeeper,
  ExponentialDecrease__factory,
  ExponentialDecrease,
} from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"
import { assert, Console } from "console"
import * as AssertHelpers from "../../helper/assert"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
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

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string
  let bobAddress: string
  let devAddress: string

  // Contracts
  let exponentialDecrease: ExponentialDecrease
  let exponentialDecreaseAsAlice: ExponentialDecrease
  let exponentialDecreaseAsBob: ExponentialDecrease

  beforeEach(async () => {
    ;({ exponentialDecrease } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])

    exponentialDecreaseAsAlice = ExponentialDecrease__factory.connect(
      exponentialDecrease.address,
      alice
    ) as ExponentialDecrease
    exponentialDecreaseAsBob = ExponentialDecrease__factory.connect(
      exponentialDecrease.address,
      bob
    ) as ExponentialDecrease
  })

  describe("#price()", () => {
    context("when starting price is 50 wad, 1% decrease at 0 second", () => {
      it("should calculate the price correctly", async () => {
        await exponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.mul(1).sub(parseEther("10000000")))
        const price = await exponentialDecrease.price(WeiPerWad.mul(50), 0)
        expect(price).to.be.equal(WeiPerWad.mul(50))
      })
    })

    context("when starting price is 50 wad, 1% decrease at 1 second", () => {
      it("should calculate the price correctly", async () => {
        await exponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.mul(1).sub(parseEther("10000000")))
        const price = await exponentialDecrease.price(WeiPerWad.mul(50), 1)
        expect(price).to.be.equal(WeiPerWad.mul(495).div(10))
      })
    })

    context("when starting price is 50 wad, 1% decrease at 2 second", () => {
      it("should calculate the price correctly", async () => {
        await exponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.mul(1).sub(parseEther("10000000")))
        const price = await exponentialDecrease.price(WeiPerWad.mul(50), 2)
        expect(price).to.be.equal(WeiPerWad.mul(49005).div(1000))
      })
    })

    context("when starting price is 50 wad, 1% decrease at 3 second", () => {
      it("should calculate the price correctly", async () => {
        await exponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.mul(1).sub(parseEther("10000000")))
        const price = await exponentialDecrease.price(WeiPerWad.mul(50), 3)
        expect(price).to.be.equal(WeiPerWad.mul(4851495).div(100000))
      })
    })

    context("when starting price is 50 wad, 100% decrease at 1 second", () => {
      it("should calculate the price correctly", async () => {
        await exponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.mul(1).sub(parseEther("1000000000")))
        const price = await exponentialDecrease.price(WeiPerWad.mul(50), 1)
        expect(price).to.be.equal(0)
      })
    })

    context("when starting price is 50, 1.123456789E27% decrease and ExpDecrease every second in 1 min", () => {
      it("should calculate the price correctly", async () => {
        await exponentialDecrease.file(
          formatBytes32String("cut"),
          WeiPerRay.mul(1).sub(parseEther("1123456789").div(100))
        )
        let price: BigNumber = WeiPerWad.mul(50)
        for (let second = 0; second < 60; second++) {
          price = await exponentialDecrease.price(price, 1)
        }
        AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("25384375980898602822").toString())
      })
    })

    context("when starting price is 50, 2.123456789E27% decrease and ExpDecrease every second in 1 min", () => {
      it("should calculate the price correctly", async () => {
        await exponentialDecrease.file(
          formatBytes32String("cut"),
          WeiPerRay.mul(1).sub(parseEther("2123456789").div(100))
        )
        let price: BigNumber = WeiPerWad.mul(50)
        for (let second = 0; second < 60; second++) {
          price = await exponentialDecrease.price(price, 1)
        }
        AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("13793909126329075412").toString())
      })
    })

    context("when starting price is 50, 1.123456789E27% decrease and ExpDecrease every 5 second in 1 min", () => {
      it("should calculate the price correctly", async () => {
        await exponentialDecrease.file(
          formatBytes32String("cut"),
          WeiPerRay.mul(1).sub(parseEther("1123456789").div(100))
        )
        let price: BigNumber = WeiPerWad.mul(50)
        for (let second = 0; second < 60; second += 5) {
          price = await exponentialDecrease.price(price, 1)
        }
        AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("43660560004238132022").toString())
      })
    })

    context("when starting price is 50, 2.123456789E27% decrease and ExpDecrease every 5 second in 1 min", () => {
      it("should calculate the price correctly", async () => {
        await exponentialDecrease.file(
          formatBytes32String("cut"),
          WeiPerRay.mul(1).sub(parseEther("2123456789").div(100))
        )
        let price: BigNumber = WeiPerWad.mul(50)
        for (let second = 0; second < 60; second += 5) {
          price = await exponentialDecrease.price(price, 1)
        }
        AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("38646794298032588398").toString())
      })
    })

    context(
      "when starting low price is 0.0000000001 wad, 1.123456789E27% decrease and ExpDecrease every second in 1 min",
      () => {
        it("should calculate the price correctly", async () => {
          await exponentialDecrease.file(
            formatBytes32String("cut"),
            WeiPerRay.mul(1).sub(parseEther("1123456789").div(100))
          )
          let price: BigNumber = WeiPerWad.div(1000000000)
          for (let second = 0; second < 60; second++) {
            price = await exponentialDecrease.price(price, 1)
          }
          AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("507687497").toString())
        })
      }
    )

    context(
      "when starting low price is 0.0000000001 wad, 2.123456789E27% decrease and ExpDecrease every 5 second in 1 min",
      () => {
        it("should calculate the price correctly", async () => {
          await exponentialDecrease.file(
            formatBytes32String("cut"),
            WeiPerRay.mul(1).sub(parseEther("2123456789").div(100))
          )
          let price: BigNumber = WeiPerWad.div(1000000000)
          for (let second = 0; second < 60; second++) {
            price = await exponentialDecrease.price(price, 1)
          }
          AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("275878167").toString())
        })
      }
    )

    context(
      "when starting low price is 0.0000000001 wad, 1.123456789E27% decrease and ExpDecrease every 5 second in 1 min",
      () => {
        it("should calculate the price correctly", async () => {
          await exponentialDecrease.file(
            formatBytes32String("cut"),
            WeiPerRay.mul(1).sub(parseEther("1123456789").div(100))
          )
          let price: BigNumber = WeiPerWad.div(1000000000)
          for (let second = 0; second < 60; second += 5) {
            price = await exponentialDecrease.price(price, 1)
          }
          AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("873211194").toString())
        })
      }
    )

    context(
      "when starting low price is 0.0000000001 wad, 2.123456789E27% decrease and ExpDecrease every 5 second in 1 min",
      () => {
        it("should calculate the price correctly", async () => {
          await exponentialDecrease.file(
            formatBytes32String("cut"),
            WeiPerRay.mul(1).sub(parseEther("2123456789").div(100))
          )
          let price: BigNumber = WeiPerWad.div(1000000000)
          for (let second = 0; second < 60; second += 5) {
            price = await exponentialDecrease.price(price, 1)
          }
          AssertHelpers.assertAlmostEqual(price.toString(), BigNumber.from("772935882").toString())
        })
      }
    )
  })
})
