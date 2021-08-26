import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { LinearDecrease__factory, LinearDecrease } from "../../../typechain"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"
import * as AssertHelpers from "../../helper/assert"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { parseEther, formatBytes32String } = ethers.utils

type fixture = {
  linearDecrease: LinearDecrease
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy LinearDecrease
  const LinearDecrease = (await ethers.getContractFactory("LinearDecrease", deployer)) as LinearDecrease__factory
  const linearDecrease = await LinearDecrease.deploy()

  return { linearDecrease }
}

describe("LinearDecrease", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer
  let bob: Signer
  let dev: Signer

  // Contracts
  let linearDecrease: LinearDecrease

  beforeEach(async () => {
    ;({ linearDecrease } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
  })

  describe("#price()", () => {
    context("when starting price is 50 wad, auction 1 min and time at 0 second", () => {
      it("should calculate the price correctly", async () => {
        await linearDecrease.file(formatBytes32String("tau"), 60)
        const price = await linearDecrease.price(WeiPerWad.mul(50), 0)
        expect(price).to.be.equal(WeiPerWad.mul(50))
      })
    })

    context("when starting price is 50 wad, auction 1 min and time at 1 second", () => {
      it("should calculate the price correctly", async () => {
        await linearDecrease.file(formatBytes32String("tau"), 60)
        const price = await linearDecrease.price(WeiPerWad.mul(50), 1)
        expect(price).to.be.equal(BigNumber.from("49166666666666666666"))
      })
    })

    context("when starting price is 50 wad, auction 1 min and time at 2 second", () => {
      it("should calculate the price correctly", async () => {
        await linearDecrease.file(formatBytes32String("tau"), 60)
        const price = await linearDecrease.price(WeiPerWad.mul(50), 2)
        expect(price).to.be.equal(BigNumber.from("48333333333333333333"))
      })
    })

    context("when starting price is 50 wad, auction 1 min and time at 59 second", () => {
      it("should calculate the price correctly", async () => {
        await linearDecrease.file(formatBytes32String("tau"), 60)
        const price = await linearDecrease.price(WeiPerWad.mul(50), 59)
        expect(price).to.be.equal(BigNumber.from("833333333333333333"))
      })
    })

    context("when starting price is 50 wad, auction 1 min and time at 60 second", () => {
      it("should calculate the price correctly", async () => {
        await linearDecrease.file(formatBytes32String("tau"), 60)
        const price = await linearDecrease.price(WeiPerWad.mul(50), 60)
        expect(price).to.be.equal(BigNumber.from("0"))
      })
    })

    context("when starting price is 50 wad, auction 1 min and time at 61 second", () => {
      it("should calculate the price correctly", async () => {
        await linearDecrease.file(formatBytes32String("tau"), 60)
        const price = await linearDecrease.price(WeiPerWad.mul(50), 61)
        expect(price).to.be.equal(BigNumber.from("0"))
      })
    })
  })
})
