import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import {
  BookKeeper,
  BookKeeper__factory,
  CollateralAuctioneer,
  CollateralAuctioneer__factory,
  PriceOracle,
  PriceOracle__factory,
  LiquidationEngine,
  LiquidationEngine__factory,
  IPriceFeed,
  IPriceFeed__factory,
  MockPriceFeed__factory,
} from "../../../../typechain"
import { smockit, MockContract, smoddit, ModifiableContract } from "@eth-optimism/smock"
import { WeiPerBln, WeiPerRad, WeiPerRay, WeiPerWad } from "../../../helper/unit"
import { zeroAddress } from "ethereumjs-util"
import { AddressOne, AddressTwo } from "../../../helper/address"
import { formatBytes32BigNumber } from "../../../helper/format"

chai.use(solidity)
const { expect } = chai
const { AddressZero, One, Zero, MaxUint256, MaxInt256 } = ethers.constants
const { parseEther, formatBytes32String } = ethers.utils

type fixture = {
  collateralAuctioneer: CollateralAuctioneer
  modifiableCollateralAuctioneer: ModifiableContract
  mockedBookKeeper: MockContract
  mockedPriceOracle: MockContract
  mockedLiquidationEngine: MockContract
  mockedPriceFeed: MockContract
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const mockedBookKeeper = await smockit(await ethers.getContractFactory("BookKeeper", deployer))

  // Deploy mocked PriceOracle
  const mockedPriceOracle = await smockit(await ethers.getContractFactory("PriceOracle", deployer))

  // Deploy mocked LiquidationEngine
  const mockedLiquidationEngine = await smockit(await ethers.getContractFactory("LiquidationEngine", deployer))

  // Deploy mocked PriceFeed
  const mockedPriceFeed = await smockit(await ethers.getContractFactory("MockPriceFeed", deployer))

  // Deploy CollateralAuctioneer
  const CollateralAuctioneer = (await ethers.getContractFactory(
    "CollateralAuctioneer",
    deployer
  )) as CollateralAuctioneer__factory
  const collateralAuctioneer = (await upgrades.deployProxy(CollateralAuctioneer, [
    mockedBookKeeper.address,
    mockedPriceOracle.address,
    mockedLiquidationEngine.address,
    formatBytes32String("BTCB"),
  ])) as CollateralAuctioneer
  await collateralAuctioneer.deployed()

  const ModifiableCollateralAuctioneer = await smoddit("CollateralAuctioneer", deployer)
  const modifiableCollateralAuctioneer = await ModifiableCollateralAuctioneer.deploy()
  await modifiableCollateralAuctioneer.initialize(
    mockedBookKeeper.address,
    mockedPriceOracle.address,
    mockedLiquidationEngine.address,
    formatBytes32String("BTCB")
  )

  return {
    collateralAuctioneer,
    modifiableCollateralAuctioneer,
    mockedBookKeeper,
    mockedPriceOracle,
    mockedLiquidationEngine,
    mockedPriceFeed,
  }
}

describe("CollateralAuctioneer", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer
  let bob: Signer
  let liquidator: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string
  let bobAddress: string
  let liquidatorAddress: string

  // Other addresses
  const positionAddress = AddressOne

  // Contracts
  let collateralAuctioneer: CollateralAuctioneer
  let modifiableCollateralAuctioneer: ModifiableContract
  let mockedBookKeeper: MockContract
  let mockedPriceOracle: MockContract
  let mockedLiquidationEngine: MockContract
  let mockedPriceFeed: MockContract
  let collateralAuctioneerAsAlice: CollateralAuctioneer
  let collateralAuctioneerAsBob: CollateralAuctioneer

  beforeEach(async () => {
    ;({
      collateralAuctioneer,
      modifiableCollateralAuctioneer,
      mockedBookKeeper,
      mockedPriceOracle,
      mockedLiquidationEngine,
      mockedPriceFeed,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, liquidator] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, liquidatorAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      liquidator.getAddress(),
    ])

    collateralAuctioneerAsAlice = CollateralAuctioneer__factory.connect(
      collateralAuctioneer.address,
      alice
    ) as CollateralAuctioneer
    collateralAuctioneerAsBob = CollateralAuctioneer__factory.connect(
      collateralAuctioneer.address,
      bob
    ) as CollateralAuctioneer
  })

  describe("#startAuction()", () => {
    context("when caller is not authorized", () => {
      it("should revert", async () => {
        // TODO: add test cases after we implement ACL
      })
    })
    context("when circuit breaker is activated (stopped > 0)", () => {
      it("should revert", async () => {
        await collateralAuctioneer["file(bytes32,uint256)"](formatBytes32String("stopped"), 1)
        await expect(
          collateralAuctioneer.startAuction(WeiPerRad, WeiPerWad, positionAddress, liquidatorAddress)
        ).to.be.revertedWith("CollateralAuctioneer/stopped-incorrect")

        await collateralAuctioneer["file(bytes32,uint256)"](formatBytes32String("stopped"), 2)
        await expect(
          collateralAuctioneer.startAuction(WeiPerRad, WeiPerWad, positionAddress, liquidatorAddress)
        ).to.be.revertedWith("CollateralAuctioneer/stopped-incorrect")
      })
    })
    context("when debt is 0", () => {
      it("should revert", async () => {
        await expect(
          collateralAuctioneer.startAuction(0, WeiPerWad, positionAddress, liquidatorAddress)
        ).to.be.revertedWith("CollateralAuctioneer/zero-debt")
      })
    })
    context("when collateralAmount is 0", () => {
      it("should revert", async () => {
        await expect(
          collateralAuctioneer.startAuction(WeiPerRad, 0, positionAddress, liquidatorAddress)
        ).to.be.revertedWith("CollateralAuctioneer/zero-collateralAmount")
      })
    })
    context("when positionAddress is zero address", () => {
      it("should revert", async () => {
        await expect(
          collateralAuctioneer.startAuction(WeiPerRad, WeiPerWad, AddressZero, liquidatorAddress)
        ).to.be.revertedWith("CollateralAuctioneer/zero-positionAddress")
      })
    })
    context("when kicks is going to overflow", () => {
      it("should revert", async () => {
        modifiableCollateralAuctioneer.smodify.put({
          kicks: MaxUint256.toHexString(),
        })
        await expect(
          modifiableCollateralAuctioneer.startAuction(WeiPerRad, WeiPerWad, positionAddress, liquidatorAddress)
        ).to.be.revertedWith("CollateralAuctioneer/overflow")
      })
    })
    context("when parameters are valid, but price is not well fed", () => {
      context("when priceFeed flagged its price as invalid", () => {
        it("should revert", async () => {
          mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
          // mock price to be 0
          mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(One), false])
          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(WeiPerRay)

          await expect(
            collateralAuctioneer.startAuction(WeiPerRad, WeiPerWad, positionAddress, liquidatorAddress)
          ).to.be.revertedWith("CollateralAuctioneer/invalid-price")
        })
      })
      context("when priceFeed returns value = 0", () => {
        it("should revert", async () => {
          mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
          // mock price to be 0
          mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(Zero), true])
          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(WeiPerRay)

          await expect(
            collateralAuctioneer.startAuction(WeiPerRad, WeiPerWad, positionAddress, liquidatorAddress)
          ).to.be.revertedWith("CollateralAuctioneer/zero-starting-price")
        })
      })
    })
    context("when parameters are valid", () => {
      const debt = WeiPerRad.mul(120000) // 120000 AUSD (rad)
      const collateralAmount = WeiPerWad.mul(2) // 2 BTCB (wad)
      const startingPriceBuffer = WeiPerRay // startingPriceBuffer is default 1 RAY
      const stableCoinReferencePrice = WeiPerRay // stableCoinReferencePrice is default 1 RAY
      const priceValue = WeiPerWad.mul(45000) // 45000 AUSD/BTCB
      // fedPrice = rdiv(mul(price, BLN), priceOracle.stableCoinReferencePrice())
      //          = (45000 RAY * 1 BLN) / (1 RAY / 1 RAY)
      const fedPrice = priceValue.mul(WeiPerBln).mul(WeiPerRay).div(stableCoinReferencePrice)
      // startingPrice = fedPrice * startingPriceBuffer
      //               = (45000 RAY * 1 BLN) * 1 RAY / 1 RAY
      const startingPrice = fedPrice.mul(startingPriceBuffer).div(WeiPerRay)

      context("when liquidatorTip and liquidatorBountyRate is not set", () => {
        it("should start auction properly without booking the prize", async () => {
          const prize = Zero

          mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
          mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(priceValue), true])
          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(stableCoinReferencePrice)

          await expect(collateralAuctioneer.startAuction(debt, collateralAmount, positionAddress, liquidatorAddress))
            .to.emit(collateralAuctioneer, "Kick")
            .withArgs(One, startingPrice, debt, collateralAmount, positionAddress, liquidatorAddress, prize)

          const { calls: collateralPoolsCalls } = mockedPriceOracle.smocked.collateralPools
          expect(collateralPoolsCalls.length).to.be.equal(1)
          expect(collateralPoolsCalls[0][0]).to.be.equal(formatBytes32String("BTCB"))

          const { calls: peekCalls } = mockedPriceFeed.smocked.peek
          expect(peekCalls.length).to.be.equal(1)

          const { calls: stableCoinReferencePriceCalls } = mockedPriceOracle.smocked.stableCoinReferencePrice
          expect(stableCoinReferencePriceCalls.length).to.be.equal(1)

          const id = await collateralAuctioneer.kicks()
          expect(id).to.be.equal(1)

          const activePosId = await collateralAuctioneer.active(0)
          expect(activePosId).to.be.equal(id)

          const sale = await collateralAuctioneer.sales(id)
          expect(sale.pos).to.be.equal(0)
          expect(sale.debt).to.be.equal(debt)
          expect(sale.collateralAmount).to.be.equal(collateralAmount)
          expect(sale.positionAddress).to.be.equal(positionAddress)
          expect(sale.startingPrice).to.be.equal(startingPrice)
        })
      })
      context("when liquidatorTip and liquidatorBountyRate is set", () => {
        it("should start auction properly and also book the prize", async () => {
          const liquidatorBountyRate = parseEther("0.05") // 5%
          const liquidatorTip = WeiPerRad.mul(100) // 100 AUSD
          // prize = liquidatorTip + (debt * bountyRate)
          //       = 100 RAD + (120000 RAD * 0.05 WAD)
          const prize = liquidatorTip.add(debt.mul(parseEther("0.05")).div(WeiPerWad))

          mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
          mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(priceValue), true])
          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(stableCoinReferencePrice)
          mockedBookKeeper.smocked.mintUnbackedStablecoin.will.return.with()

          // set liquidatorBountyRate 5%
          await collateralAuctioneer["file(bytes32,uint256)"](
            formatBytes32String("liquidatorBountyRate"),
            liquidatorBountyRate
          )
          // set liquidatorTip to 100 AUSD
          await collateralAuctioneer["file(bytes32,uint256)"](formatBytes32String("liquidatorTip"), liquidatorTip)

          await expect(collateralAuctioneer.startAuction(debt, collateralAmount, positionAddress, liquidatorAddress))
            .to.emit(collateralAuctioneer, "Kick")
            .withArgs(One, startingPrice, debt, collateralAmount, positionAddress, liquidatorAddress, prize)

          const { calls: collateralPoolsCalls } = mockedPriceOracle.smocked.collateralPools
          expect(collateralPoolsCalls.length).to.be.equal(1)
          expect(collateralPoolsCalls[0][0]).to.be.equal(formatBytes32String("BTCB"))

          const { calls: peekCalls } = mockedPriceFeed.smocked.peek
          expect(peekCalls.length).to.be.equal(1)

          const { calls: stableCoinReferencePriceCalls } = mockedPriceOracle.smocked.stableCoinReferencePrice
          expect(stableCoinReferencePriceCalls.length).to.be.equal(1)

          const { calls: mintUnbackedStablecoinCalls } = mockedBookKeeper.smocked.mintUnbackedStablecoin
          expect(mintUnbackedStablecoinCalls.length).to.be.equal(1)
          expect(mintUnbackedStablecoinCalls[0].from).to.be.equal(AddressZero)
          expect(mintUnbackedStablecoinCalls[0].to).to.be.equal(liquidatorAddress)
          expect(mintUnbackedStablecoinCalls[0].rad).to.be.equal(prize)

          const id = await collateralAuctioneer.kicks()
          expect(id).to.be.equal(1)

          const activePosId = await collateralAuctioneer.active(0)
          expect(activePosId).to.be.equal(id)

          const sale = await collateralAuctioneer.sales(id)
          expect(sale.pos).to.be.equal(0)
          expect(sale.debt).to.be.equal(debt)
          expect(sale.collateralAmount).to.be.equal(collateralAmount)
          expect(sale.positionAddress).to.be.equal(positionAddress)
          expect(sale.startingPrice).to.be.equal(startingPrice)
        })
      })
    })
  })
})
