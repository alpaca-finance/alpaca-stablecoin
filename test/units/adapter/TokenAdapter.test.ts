import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { BookKeeper__factory, BookKeeper, TokenAdapter, TokenAdapter__factory } from "../../../typechain"
import { MockContract, smockit } from "@eth-optimism/smock"
import { ERC20__factory } from "../../../typechain/factories/ERC20__factory"
import { WeiPerWad } from "../../helper/unit"

type fixture = {
  tokenAdapter: TokenAdapter
  mockedBookKeeper: MockContract
  mockedToken: MockContract
}
chai.use(solidity)
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
  const token = await Token.deploy("BTCB", "BTCB")
  await token.deployed()
  const mockedToken = await smockit(token)

  // Deploy TokenAdapter
  const TokenAdapter = (await ethers.getContractFactory("TokenAdapter", deployer)) as TokenAdapter__factory
  const tokenAdapter = (await upgrades.deployProxy(TokenAdapter, [
    mockedBookKeeper.address,
    formatBytes32String("BTCB"),
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
    context("when the token adapter is inactive", () => {
      it("should revert", async () => {
        tokenAdapter.cage()
        await expect(tokenAdapter.deposit(aliceAddress, WeiPerWad.mul(1))).to.be.revertedWith("TokenAdapter/not-live")
      })
    })

    context("when wad input is overflow (> MaxInt256)", () => {
      it("should revert", async () => {
        await expect(tokenAdapter.deposit(aliceAddress, ethers.constants.MaxUint256)).to.be.revertedWith(
          "TokenAdapter/overflow"
        )
      })
    })

    context("when transfer fail", () => {
      it("should revert", async () => {
        await expect(tokenAdapter.deposit(aliceAddress, WeiPerWad.mul(1))).to.be.revertedWith(
          "TokenAdapter/failed-transfer"
        )
      })
    })

    context("when parameters are valid", () => {
      it("should be able to call bookkeeper.addCollateral() correctly", async () => {
        mockedBookKeeper.smocked.addCollateral.will.return.with()
        mockedToken.smocked.transferFrom.will.return.with(true)
        await tokenAdapter.deposit(aliceAddress, WeiPerWad.mul(1))

        const { calls: addCollateral } = mockedBookKeeper.smocked.addCollateral
        const { calls: transferFrom } = mockedToken.smocked.transferFrom
        expect(addCollateral.length).to.be.equal(1)
        expect(addCollateral[0].collateralPoolId).to.be.equal(formatBytes32String("BTCB"))
        expect(addCollateral[0].usr).to.be.equal(aliceAddress)
        expect(addCollateral[0].wad).to.be.equal(BigNumber.from("1000000000000000000"))

        expect(transferFrom.length).to.be.equal(1)
        expect(transferFrom[0].sender).to.be.equal(deployerAddress)
        expect(transferFrom[0].recipient).to.be.equal(tokenAdapter.address)
        expect(transferFrom[0].amount).to.be.equal(BigNumber.from("1000000000000000000"))
      })
    })
  })

  describe("#withdraw()", () => {
    context("when wad input is overflow (> MaxInt256)", () => {
      it("should revert", async () => {
        await expect(tokenAdapter.withdraw(aliceAddress, ethers.constants.MaxUint256)).to.be.revertedWith(
          "TokenAdapter/overflow"
        )
      })
    })

    context("when transfer fail", () => {
      it("should revert", async () => {
        await expect(tokenAdapter.withdraw(aliceAddress, WeiPerWad.mul(1))).to.be.revertedWith(
          "TokenAdapter/failed-transfer"
        )
      })
    })

    context("when parameters are valid", () => {
      it("should be able to call bookkeeper.addCollateral() correctly", async () => {
        mockedBookKeeper.smocked.addCollateral.will.return.with()
        mockedToken.smocked.transfer.will.return.with(true)
        await tokenAdapter.withdraw(aliceAddress, WeiPerWad.mul(1))

        const { calls: addCollateral } = mockedBookKeeper.smocked.addCollateral
        const { calls: transfer } = mockedToken.smocked.transfer
        expect(addCollateral.length).to.be.equal(1)
        expect(addCollateral[0].collateralPoolId).to.be.equal(formatBytes32String("BTCB"))
        expect(addCollateral[0].usr).to.be.equal(deployerAddress)
        expect(addCollateral[0].wad).to.be.equal(BigNumber.from("-1000000000000000000"))

        expect(transfer.length).to.be.equal(1)
        expect(transfer[0].recipient).to.be.equal(aliceAddress)
        expect(transfer[0].amount).to.be.equal(BigNumber.from("1000000000000000000"))
      })
    })
  })

  describe("#cage()", () => {
    context("when setting token adapter is inactive ", () => {
      it("should be set live to 0", async () => {
        expect(await tokenAdapter.live()).to.be.equal(1)

        await tokenAdapter.cage()

        expect(await tokenAdapter.live()).to.be.equal(0)
      })
    })
  })

  describe("#rely()", () => {
    context("when call rely ", () => {
      it("should be set wards to 1", async () => {
        expect(await tokenAdapter.wards(aliceAddress)).to.be.equal(0)

        await tokenAdapter.rely(aliceAddress)

        expect(await tokenAdapter.wards(aliceAddress)).to.be.equal(1)
      })
    })
  })

  describe("#deny()", () => {
    context("when call deny ", () => {
      it("should be set wards to 0", async () => {
        await tokenAdapter.rely(aliceAddress)
        expect(await tokenAdapter.wards(aliceAddress)).to.be.equal(1)

        await tokenAdapter.deny(aliceAddress)
        expect(await tokenAdapter.wards(aliceAddress)).to.be.equal(0)
      })
    })
  })
})
