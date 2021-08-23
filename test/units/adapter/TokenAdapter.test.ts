import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { BookKeeper__factory, BookKeeper, TokenAdapter, TokenAdapter__factory } from "../../../typechain"
import { MockContract, smockit } from "@eth-optimism/smock"
import { ERC20__factory } from "../../../typechain/factories/ERC20__factory"

type fixture = {
  tokenAdapter: TokenAdapter
  mockedBookKeeper: MockContract
  mockedToken: MockContract
}
// chai.use(solidity)
const { expect } = chai
const { AddressZero, WeiPerEther } = ethers.constants
const { parseEther, formatBytes32String } = ethers.utils

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked booster config
  const BookKeeper = (await ethers.getContractFactory("BookKeeper", deployer)) as BookKeeper__factory
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [])) as BookKeeper
  await bookKeeper.deployed()
  const mockedBookKeeper = await smockit(bookKeeper)

  const Token = (await ethers.getContractFactory("ERC20", deployer)) as ERC20__factory
  const token = await Token.deploy("BNB", "BNB")
  const mockedToken = await smockit(token)

  // Deploy TokenAdapter
  const TokenAdapter = (await ethers.getContractFactory("TokenAdapter", deployer)) as TokenAdapter__factory
  const tokenAdapter = (await upgrades.deployProxy(TokenAdapter, [
    mockedBookKeeper.address,
    formatBytes32String("BNB"),
    mockedToken.address,
  ])) as TokenAdapter
  await tokenAdapter.deployed()

  return { tokenAdapter, mockedBookKeeper, mockedToken }
}

describe("TokenAdapter", () => {
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

  //Contract
  let tokenAdapter: TokenAdapter
  let mockedBookKeeper: MockContract
  let mockedToken: MockContract
  let tokenAdapterAsAlice: TokenAdapter

  beforeEach(async () => {
    //waffle
    ;({ tokenAdapter, mockedBookKeeper, mockedToken } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])

    tokenAdapterAsAlice = TokenAdapter__factory.connect(tokenAdapter.address, alice) as TokenAdapter
  })

  describe("#deposit()", () => {
    context("when not-live", () => {
      it("should revert", async () => {
        tokenAdapter.cage()
        await expect(tokenAdapter.deposit(aliceAddress, 1)).to.be.revertedWith("TokenAdapter/not-live")
      })
    })

    context("when overflow", () => {
      it("should revert", async () => {
        await expect(tokenAdapter.deposit(aliceAddress, ethers.constants.MaxUint256)).to.be.revertedWith(
          "TokenAdapter/overflow"
        )
      })
    })

    context("when failed-transfer", () => {
      it("should revert", async () => {
        await expect(tokenAdapter.deposit(aliceAddress, 1)).to.be.revertedWith("TokenAdapter/failed-transfer")
      })
    })

    context("when parameters are valid", () => {
      it("should be able to call deposit()", async () => {
        mockedBookKeeper.smocked.addCollateral.will.return.with()
        mockedToken.smocked.transferFrom.will.return.with(true)
        await tokenAdapter.deposit(aliceAddress, 1)

        const { calls } = mockedBookKeeper.smocked.addCollateral
        expect(calls.length).to.be.equal(1)
        expect(calls[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(calls[0].usr).to.be.equal(aliceAddress)
        expect(calls[0].wad).to.be.equal(BigNumber.from("1"))
      })
    })
  })

  describe("#withdraw()", () => {
    context("when overflow", () => {
      it("should revert", async () => {
        await expect(tokenAdapter.withdraw(aliceAddress, ethers.constants.MaxUint256)).to.be.revertedWith(
          "TokenAdapter/overflow"
        )
      })
    })

    context("when failed-transfer", () => {
      it("should revert", async () => {
        await expect(tokenAdapter.withdraw(aliceAddress, 1)).to.be.revertedWith("TokenAdapter/failed-transfer")
      })
    })

    context("when parameters are valid", () => {
      it("should be able to call withdraw()", async () => {
        mockedBookKeeper.smocked.addCollateral.will.return.with()
        mockedToken.smocked.transfer.will.return.with(true)
        await tokenAdapter.withdraw(aliceAddress, 1)

        const { calls } = mockedBookKeeper.smocked.addCollateral
        expect(calls.length).to.be.equal(1)
        expect(calls[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(calls[0].usr).to.be.equal(deployerAddress)
        expect(calls[0].wad).to.be.equal(BigNumber.from("-1"))
      })
    })
  })
})
