import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { CollateralAuctioneer, CollateralAuctioneer__factory } from "../../../../typechain"
import { smockit, MockContract, smoddit, ModifiableContract } from "@eth-optimism/smock"
import { WeiPerBln, WeiPerRad, WeiPerRay, WeiPerWad } from "../../../helper/unit"
import { AddressOne, AddressTwo } from "../../../helper/address"
import { formatBytes32BigNumber } from "../../../helper/format"
import { increase } from "../../../helper/time"

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
  mockedLinearDecrease: MockContract
  mockedPositionManager: MockContract
  mockedIbTokenAdapter: MockContract
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

  // Deploy mocked LinearDecrease
  const mockedLinearDecrease = await smockit(await ethers.getContractFactory("LinearDecrease", deployer))

  // Deploy mocked PositionManager
  const mockedPositionManager = await smockit(await ethers.getContractFactory("PositionManager", deployer))

  // Deploy mocked IbTokenAdapter
  const mockedIbTokenAdapter = await smockit(await ethers.getContractFactory("IbTokenAdapter", deployer))

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
    mockedPositionManager.address,
    mockedIbTokenAdapter.address,
  ])) as CollateralAuctioneer
  await collateralAuctioneer.deployed()

  const ModifiableCollateralAuctioneer = await smoddit("CollateralAuctioneer", deployer)
  const modifiableCollateralAuctioneer = await ModifiableCollateralAuctioneer.deploy()
  await modifiableCollateralAuctioneer.initialize(
    mockedBookKeeper.address,
    mockedPriceOracle.address,
    mockedLiquidationEngine.address,
    formatBytes32String("BTCB"),
    mockedPositionManager.address,
    mockedIbTokenAdapter.address
  )
  await modifiableCollateralAuctioneer.deployed()

  return {
    collateralAuctioneer,
    modifiableCollateralAuctioneer,
    mockedBookKeeper,
    mockedPriceOracle,
    mockedLiquidationEngine,
    mockedPriceFeed,
    mockedLinearDecrease,
    mockedIbTokenAdapter,
    mockedPositionManager,
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
  const systemDebtEngineAddress = AddressTwo

  // Contracts
  let collateralAuctioneer: CollateralAuctioneer
  let modifiableCollateralAuctioneer: ModifiableContract
  let mockedBookKeeper: MockContract
  let mockedPriceOracle: MockContract
  let mockedLiquidationEngine: MockContract
  let mockedPriceFeed: MockContract
  let mockedLinearDecrease: MockContract
  let mockedPositionManager: MockContract
  let mockedIbTokenAdapter: MockContract

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
      mockedLinearDecrease,
      mockedIbTokenAdapter,
      mockedPositionManager,
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
          mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(One), false])
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
          mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(Zero), true])
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
          mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(priceValue), true])
          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(stableCoinReferencePrice)

          mockedPositionManager.smocked.mapPositionHandlerToOwner.will.return.with(deployerAddress)

          await expect(collateralAuctioneer.startAuction(debt, collateralAmount, positionAddress, liquidatorAddress))
            .to.emit(collateralAuctioneer, "Kick")
            .withArgs(One, startingPrice, debt, collateralAmount, positionAddress, liquidatorAddress, prize)

          const { calls: collateralPoolsCalls } = mockedPriceOracle.smocked.collateralPools
          expect(collateralPoolsCalls.length).to.be.equal(1)
          expect(collateralPoolsCalls[0][0]).to.be.equal(formatBytes32String("BTCB"))

          const { calls: peekCalls } = mockedPriceFeed.smocked.peekPrice
          expect(peekCalls.length).to.be.equal(1)

          const { calls: stableCoinReferencePriceCalls } = mockedPriceOracle.smocked.stableCoinReferencePrice
          expect(stableCoinReferencePriceCalls.length).to.be.equal(1)

          const { calls: positionManagerCalls } = mockedPositionManager.smocked.mapPositionHandlerToOwner
          expect(positionManagerCalls.length).to.be.eq(1)
          expect(positionManagerCalls[0][0]).to.be.eq(positionAddress)

          const { calls: ibTokenAdapterCalls } = mockedIbTokenAdapter.smocked.onMoveCollateral
          expect(ibTokenAdapterCalls.length).to.be.eq(1)
          expect(ibTokenAdapterCalls[0].source).to.be.eq(positionAddress)
          expect(ibTokenAdapterCalls[0].destination).to.be.eq(collateralAuctioneer.address)
          expect(ibTokenAdapterCalls[0].wad).to.be.eq(collateralAmount)
          expect(ibTokenAdapterCalls[0].data).to.be.eq(
            ethers.utils.defaultAbiCoder.encode(["address"], [deployerAddress])
          )

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
          mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(priceValue), true])
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

          const { calls: peekCalls } = mockedPriceFeed.smocked.peekPrice
          expect(peekCalls.length).to.be.equal(1)

          const { calls: stableCoinReferencePriceCalls } = mockedPriceOracle.smocked.stableCoinReferencePrice
          expect(stableCoinReferencePriceCalls.length).to.be.equal(1)

          const { calls: mintUnbackedStablecoinCalls } = mockedBookKeeper.smocked.mintUnbackedStablecoin
          expect(mintUnbackedStablecoinCalls.length).to.be.equal(1)
          expect(mintUnbackedStablecoinCalls[0].from).to.be.equal(AddressZero)
          expect(mintUnbackedStablecoinCalls[0].to).to.be.equal(liquidatorAddress)
          expect(mintUnbackedStablecoinCalls[0].value).to.be.equal(prize)

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

  describe("#redo()", () => {
    const startAuctionWithDefaultParams = async () => {
      const debt = WeiPerRad.mul(120000) // 120000 AUSD (rad)
      const collateralAmount = WeiPerWad.mul(2) // 2 BTCB (wad)
      const stableCoinReferencePrice = WeiPerRay // stableCoinReferencePrice is default 1 RAY
      const priceValue = WeiPerWad.mul(45000) // 45000 AUSD/BTCB

      // start an auction
      await startAuction(priceValue, stableCoinReferencePrice, debt, collateralAmount)
    }

    const startAuction = async (
      priceValue: BigNumber,
      stableCoinReferencePrice: BigNumber,
      debt: BigNumber,
      collateralAmount: BigNumber
    ) => {
      mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
      mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(priceValue), true])
      mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(stableCoinReferencePrice)

      await collateralAuctioneer.startAuction(debt, collateralAmount, positionAddress, liquidatorAddress)

      mockedPriceFeed.smocked.peekPrice.reset()
      mockedPriceOracle.smocked.collateralPools.reset()
      mockedPriceOracle.smocked.stableCoinReferencePrice.reset()
    }

    context("when caller is not authorized", () => {
      it("should revert", async () => {
        // TODO: add test cases after we implement ACL
      })
    })
    context("when circuit breaker is activated (stopped > 1)", () => {
      it("should revert", async () => {
        await startAuctionWithDefaultParams()
        await collateralAuctioneer["file(bytes32,uint256)"](formatBytes32String("stopped"), 2)
        await expect(collateralAuctioneer.redo(1, liquidatorAddress)).to.be.revertedWith(
          "CollateralAuctioneer/stopped-incorrect"
        )

        await collateralAuctioneer["file(bytes32,uint256)"](formatBytes32String("stopped"), 3)
        await expect(collateralAuctioneer.redo(1, liquidatorAddress)).to.be.revertedWith(
          "CollateralAuctioneer/stopped-incorrect"
        )
      })
    })

    context("when given auction id has not been started yet", () => {
      it("should revert", async () => {
        await expect(collateralAuctioneer.redo(1, liquidatorAddress)).to.be.revertedWith(
          "CollateralAuctioneer/not-running-auction"
        )
      })
    })

    context("when given auction id has not done yet", () => {
      context("when price has not drop to the reset threshold yet", () => {
        it("should revert", async () => {
          await startAuctionWithDefaultParams()

          // config the auction time limit to be forver
          await collateralAuctioneer["file(bytes32,uint256)"](formatBytes32String("auctionTimeLimit"), MaxUint256)
          // config price threshold to be 50%
          await collateralAuctioneer["file(bytes32,uint256)"](
            formatBytes32String("priceDropBeforeReset"),
            WeiPerRay.div(2) // 50%
          )
          await collateralAuctioneer["file(bytes32,address)"](formatBytes32String("calc"), mockedLinearDecrease.address)

          // set the price to be a little bit above threshold, then it should revert
          mockedLinearDecrease.smocked.price.will.return.with(WeiPerRay.mul(22501))
          await expect(collateralAuctioneer.redo(1, liquidatorAddress)).to.be.revertedWith(
            "CollateralAuctioneer/cannot-reset"
          )

          // set the price to be a little bit below threshold, then it should able to redo
          mockedLinearDecrease.smocked.price.will.return.with(WeiPerRay.mul(22499))
          await expect(collateralAuctioneer.redo(1, liquidatorAddress)).not.to.be.reverted
        })
      })
      context("when timestamp has not reach auction time limit yet", () => {
        it("should revert before 3 seconds", async () => {
          await startAuctionWithDefaultParams()

          // Set auctionTimeLimit 9 seconds
          await collateralAuctioneer["file(bytes32,uint256)"](formatBytes32String("auctionTimeLimit"), One.mul(9))
          await collateralAuctioneer["file(bytes32,address)"](formatBytes32String("calc"), mockedLinearDecrease.address)

          // start mocking for redo()
          mockedLinearDecrease.smocked.price.will.return.with(One)

          // redo should fail
          await expect(collateralAuctioneer.redo(1, liquidatorAddress)).to.be.revertedWith(
            "CollateralAuctioneer/cannot-reset"
          )
          // wait for 3 sec (+some await time), redo should still failt
          // await new Promise((r) => setTimeout(r, 1000))
          await increase(One.mul(3))
          await expect(collateralAuctioneer.redo(1, liquidatorAddress)).to.be.revertedWith(
            "CollateralAuctioneer/cannot-reset"
          )

          // wait for 6 secs, it should not revert
          await increase(One.mul(6))
          await expect(collateralAuctioneer.redo(1, liquidatorAddress)).not.to.be.reverted
        })
      })
    })

    context("when starting price is calculated as 0", () => {
      context("when fed price = 0", () => {
        it("should revert", async () => {
          await startAuctionWithDefaultParams()

          const stableCoinReferencePrice = WeiPerRay // stableCoinReferencePrice is default 1 RAY
          const priceValue = Zero

          mockedLinearDecrease.smocked.price.will.return.with(One)

          mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
          mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(priceValue), true])
          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(stableCoinReferencePrice)

          await collateralAuctioneer["file(bytes32,address)"](formatBytes32String("calc"), mockedLinearDecrease.address)

          await expect(collateralAuctioneer.redo(1, liquidatorAddress)).to.be.revertedWith(
            "CollateralAuctioneer/zero-starting-price"
          )
        })
      })

      context("when startingPriceBuffer = 0", () => {
        it("should revert", async () => {
          await startAuctionWithDefaultParams()

          const stableCoinReferencePrice = WeiPerRay // stableCoinReferencePrice is default 1 RAY
          const priceValue = WeiPerWad.mul(45000) // 45000 AUSD/BTCB

          mockedLinearDecrease.smocked.price.will.return.with(One)

          mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
          mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(priceValue), true])
          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(stableCoinReferencePrice)

          await collateralAuctioneer["file(bytes32,address)"](formatBytes32String("calc"), mockedLinearDecrease.address)

          // force set startingPriceBuffer = 0
          await collateralAuctioneer["file(bytes32,uint256)"](formatBytes32String("startingPriceBuffer"), Zero)

          await expect(collateralAuctioneer.redo(1, liquidatorAddress)).to.be.revertedWith(
            "CollateralAuctioneer/zero-starting-price"
          )
        })
      })
    })

    context("when parameters are valid", () => {
      context("when liquidatorTip and liquidatorBountyRate is not set", () => {
        it("should start auction properly without booking the prize", async () => {
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
          const prize = Zero

          // start an auction
          {
            mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
            mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(priceValue), true])
            mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(stableCoinReferencePrice)

            await collateralAuctioneer.startAuction(debt, collateralAmount, positionAddress, liquidatorAddress)

            mockedPriceFeed.smocked.peekPrice.reset()
            mockedPriceOracle.smocked.collateralPools.reset()
            mockedPriceOracle.smocked.stableCoinReferencePrice.reset()
          }

          // start mocking for redo()
          mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
          mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(priceValue), true])
          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(stableCoinReferencePrice)
          mockedLinearDecrease.smocked.price.will.return.with(fedPrice)

          await collateralAuctioneer["file(bytes32,address)"](formatBytes32String("calc"), mockedLinearDecrease.address)

          await collateralAuctioneer.redo(1, liquidatorAddress)

          const { calls: collateralPoolsCalls } = mockedPriceOracle.smocked.collateralPools
          expect(collateralPoolsCalls.length).to.be.equal(1)
          expect(collateralPoolsCalls[0][0]).to.be.equal(formatBytes32String("BTCB"))

          const { calls: peekCalls } = mockedPriceFeed.smocked.peekPrice
          expect(peekCalls.length).to.be.equal(1)

          const { calls: stableCoinReferencePriceCalls } = mockedPriceOracle.smocked.stableCoinReferencePrice
          expect(stableCoinReferencePriceCalls.length).to.be.equal(1)

          const { calls: linearDecreasePriceCalls } = mockedLinearDecrease.smocked.price
          expect(linearDecreasePriceCalls.length).to.be.equal(1)
          expect(linearDecreasePriceCalls[0][0]).to.be.equal(startingPrice)

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
        it("should start auction properly without booking the prize", async () => {
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
          const liquidatorBountyRate = parseEther("0.05") // 5%
          const liquidatorTip = WeiPerRad.mul(100) // 100 AUSD
          // prize = liquidatorTip + (debt * bountyRate)
          //       = 100 RAD + (120000 RAD * 0.05 WAD)
          const prize = liquidatorTip.add(debt.mul(parseEther("0.05")).div(WeiPerWad))

          // start an auction
          {
            mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
            mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(priceValue), true])
            mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(stableCoinReferencePrice)

            await collateralAuctioneer.startAuction(debt, collateralAmount, positionAddress, liquidatorAddress)

            mockedPriceFeed.smocked.peekPrice.reset()
            mockedPriceOracle.smocked.collateralPools.reset()
            mockedPriceOracle.smocked.stableCoinReferencePrice.reset()
          }

          // start mocking for redo()
          mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
          mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(priceValue), true])
          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(stableCoinReferencePrice)
          mockedLinearDecrease.smocked.price.will.return.with(fedPrice)
          mockedBookKeeper.smocked.mintUnbackedStablecoin.will.return.with()

          // set liquidatorBountyRate 5%
          await collateralAuctioneer["file(bytes32,uint256)"](
            formatBytes32String("liquidatorBountyRate"),
            liquidatorBountyRate
          )
          // set liquidatorTip to 100 AUSD
          await collateralAuctioneer["file(bytes32,uint256)"](formatBytes32String("liquidatorTip"), liquidatorTip)
          await collateralAuctioneer["file(bytes32,address)"](formatBytes32String("calc"), mockedLinearDecrease.address)

          await collateralAuctioneer.redo(1, liquidatorAddress)

          await expect(collateralAuctioneer.redo(1, liquidatorAddress))
            .to.emit(collateralAuctioneer, "Redo")
            .withArgs(One, startingPrice, debt, collateralAmount, positionAddress, liquidatorAddress, prize)

          const { calls: collateralPoolsCalls } = mockedPriceOracle.smocked.collateralPools
          expect(collateralPoolsCalls.length).to.be.equal(1)
          expect(collateralPoolsCalls[0][0]).to.be.equal(formatBytes32String("BTCB"))

          const { calls: peekCalls } = mockedPriceFeed.smocked.peekPrice
          expect(peekCalls.length).to.be.equal(1)

          const { calls: stableCoinReferencePriceCalls } = mockedPriceOracle.smocked.stableCoinReferencePrice
          expect(stableCoinReferencePriceCalls.length).to.be.equal(1)

          const { calls: linearDecreasePriceCalls } = mockedLinearDecrease.smocked.price
          expect(linearDecreasePriceCalls.length).to.be.equal(1)
          expect(linearDecreasePriceCalls[0][0]).to.be.equal(startingPrice)

          const { calls: mintUnbackedStablecoinCalls } = mockedBookKeeper.smocked.mintUnbackedStablecoin
          expect(mintUnbackedStablecoinCalls.length).to.be.equal(1)
          expect(mintUnbackedStablecoinCalls[0].from).to.be.equal(AddressZero)
          expect(mintUnbackedStablecoinCalls[0].to).to.be.equal(liquidatorAddress)
          expect(mintUnbackedStablecoinCalls[0].value).to.be.equal(prize)

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
        context("but remaining debt value is higher than debt or collateral value (mocked as MaxUint)", () => {
          it("should start auction properly without booking the prize", async () => {
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
            const liquidatorBountyRate = parseEther("0.05") // 5%
            const liquidatorTip = WeiPerRad.mul(100) // 100 AUSD

            const prize = Zero

            // start an auction
            {
              mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
              mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(priceValue), true])
              mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(stableCoinReferencePrice)

              await modifiableCollateralAuctioneer.startAuction(
                debt,
                collateralAmount,
                positionAddress,
                liquidatorAddress
              )

              mockedPriceFeed.smocked.peekPrice.reset()
              mockedPriceOracle.smocked.collateralPools.reset()
              mockedPriceOracle.smocked.stableCoinReferencePrice.reset()
            }

            // start mocking for redo()
            mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
            mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(priceValue), true])
            mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(stableCoinReferencePrice)
            mockedLinearDecrease.smocked.price.will.return.with(fedPrice)
            // mockedBookKeeper.smocked.mintUnbackedStablecoin.will.return.with()

            // set liquidatorBountyRate 5%
            await modifiableCollateralAuctioneer["file(bytes32,uint256)"](
              formatBytes32String("liquidatorBountyRate"),
              liquidatorBountyRate
            )
            // set liquidatorTip to 100 AUSD
            await modifiableCollateralAuctioneer["file(bytes32,uint256)"](
              formatBytes32String("liquidatorTip"),
              liquidatorTip
            )
            await modifiableCollateralAuctioneer["file(bytes32,address)"](
              formatBytes32String("calc"),
              mockedLinearDecrease.address
            )

            // force set minimumRemainingDebt
            await modifiableCollateralAuctioneer.smodify.put({
              minimumRemainingDebt: MaxUint256.toHexString(),
            })
            await expect(modifiableCollateralAuctioneer.redo(1, liquidatorAddress))
              .to.emit(modifiableCollateralAuctioneer, "Redo")
              .withArgs(One, startingPrice, debt, collateralAmount, positionAddress, liquidatorAddress, prize)

            const { calls: collateralPoolsCalls } = mockedPriceOracle.smocked.collateralPools
            expect(collateralPoolsCalls.length).to.be.equal(1)
            expect(collateralPoolsCalls[0][0]).to.be.equal(formatBytes32String("BTCB"))

            const { calls: peekCalls } = mockedPriceFeed.smocked.peekPrice
            expect(peekCalls.length).to.be.equal(1)

            const { calls: stableCoinReferencePriceCalls } = mockedPriceOracle.smocked.stableCoinReferencePrice
            expect(stableCoinReferencePriceCalls.length).to.be.equal(1)

            const { calls: linearDecreasePriceCalls } = mockedLinearDecrease.smocked.price
            expect(linearDecreasePriceCalls.length).to.be.equal(1)
            expect(linearDecreasePriceCalls[0][0]).to.be.equal(startingPrice)

            const id = await modifiableCollateralAuctioneer.kicks()
            expect(id).to.be.equal(1)

            const activePosId = await modifiableCollateralAuctioneer.active(0)
            expect(activePosId).to.be.equal(id)

            const sale = await modifiableCollateralAuctioneer.sales(id)
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

  describe("#take()", () => {
    const startAuctionWithDefaultParams = async () => {
      const debt = WeiPerRad.mul(120000) // 120000 AUSD (rad)
      const collateralAmount = WeiPerWad.mul(2) // 2 BTCB (wad)
      const stableCoinReferencePrice = WeiPerRay // stableCoinReferencePrice is default 1 RAY
      const priceValue = WeiPerWad.mul(45000) // 45000 AUSD/BTCB

      // start an auction
      await startAuction(priceValue, stableCoinReferencePrice, debt, collateralAmount)
    }

    const startAuction = async (
      priceValue: BigNumber,
      stableCoinReferencePrice: BigNumber,
      debt: BigNumber,
      collateralAmount: BigNumber
    ) => {
      mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, WeiPerRay])
      mockedPriceFeed.smocked.peekPrice.will.return.with([formatBytes32BigNumber(priceValue), true])
      mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(stableCoinReferencePrice)

      await collateralAuctioneer.startAuction(debt, collateralAmount, positionAddress, liquidatorAddress)

      mockedPriceFeed.smocked.peekPrice.reset()
      mockedPriceOracle.smocked.collateralPools.reset()
      mockedPriceOracle.smocked.stableCoinReferencePrice.reset()
    }
    context("when circuit breaker is activated (stopped > 2)", () => {
      it("should revert", async () => {
        await startAuctionWithDefaultParams()
        await collateralAuctioneer["file(bytes32,uint256)"](formatBytes32String("stopped"), 3)
        await expect(
          collateralAuctioneer.take(1, WeiPerWad.mul(2), WeiPerRay.mul(46000), aliceAddress, "0x")
        ).to.be.revertedWith("CollateralAuctioneer/stopped-incorrect")
      })
    })
    context("when given auction id has not been started yet", () => {
      it("should revert", async () => {
        await expect(
          collateralAuctioneer.take(1, WeiPerWad.mul(2), WeiPerRay.mul(46000), aliceAddress, "0x")
        ).to.be.revertedWith("CollateralAuctioneer/not-running-auction")
      })
    })
    context("when given auction id needs reset", () => {
      it("should revert, as it cannot be taken", async () => {
        // config the auction time limit to be zero to force it done
        await collateralAuctioneer["file(bytes32,uint256)"](formatBytes32String("auctionTimeLimit"), Zero)
        await startAuctionWithDefaultParams()

        // set calculator and mock some price
        await collateralAuctioneer["file(bytes32,address)"](formatBytes32String("calc"), mockedLinearDecrease.address)
        mockedLinearDecrease.smocked.price.will.return.with(WeiPerRay.mul(45000))

        await expect(
          collateralAuctioneer.take(1, WeiPerWad.mul(2), WeiPerRay.mul(46000), aliceAddress, "0x")
        ).to.be.revertedWith("CollateralAuctioneer/needs-reset")
      })
    })
    context("when given maxPrice is lower than the actual price calculated", () => {
      it("should revert", async () => {
        // config the auction time limit to be forver to force it not done
        await collateralAuctioneer["file(bytes32,uint256)"](formatBytes32String("auctionTimeLimit"), MaxUint256)
        await startAuctionWithDefaultParams()

        // set calculator and mock the price to be 45000
        await collateralAuctioneer["file(bytes32,address)"](formatBytes32String("calc"), mockedLinearDecrease.address)
        mockedLinearDecrease.smocked.price.will.return.with(WeiPerRay.mul(45000))

        // try input maxPrice with 44000
        await expect(
          collateralAuctioneer.take(1, WeiPerWad.mul(2), WeiPerRay.mul(44000), aliceAddress, "0x")
        ).to.be.revertedWith("CollateralAuctioneer/too-expensive")
      })
    })

    context("when all params are valid", () => {
      context("when alice wants to buy the entire postion", () => {
        it("should be done successfully and correctly", async () => {
          // config the auction time limit to be forver to force it not done
          await collateralAuctioneer["file(bytes32,uint256)"](formatBytes32String("auctionTimeLimit"), MaxUint256)
          await startAuctionWithDefaultParams()

          const price = WeiPerRay.mul(45000)
          mockedLinearDecrease.smocked.price.will.return.with(price)
          mockedBookKeeper.smocked.moveCollateral.will.return.with()
          mockedBookKeeper.smocked.moveStablecoin.will.return.with()
          mockedLiquidationEngine.smocked.removeRepaidDebtFromAuction.will.return.with()
          await collateralAuctioneer["file(bytes32,address)"](formatBytes32String("calc"), mockedLinearDecrease.address)
          await collateralAuctioneer["file(bytes32,address)"](
            formatBytes32String("systemDebtEngine"),
            systemDebtEngineAddress
          )
          console.log()
          await collateralAuctioneer.take(1, MaxUint256, WeiPerRay.mul(46000), aliceAddress, "0x")

          const { calls: priceCalls } = mockedLinearDecrease.smocked.price
          expect(priceCalls.length).to.be.equal(1)

          const { calls: moveCollateralCalls } = mockedBookKeeper.smocked.moveCollateral
          expect(moveCollateralCalls.length).to.be.equal(1)
          expect(moveCollateralCalls[0].collateralPoolId).to.be.equal(formatBytes32String("BTCB"))
          expect(moveCollateralCalls[0].src).to.be.equal(collateralAuctioneer.address)
          expect(moveCollateralCalls[0].dst).to.be.equal(aliceAddress)
          expect(moveCollateralCalls[0].amount).to.be.equal(WeiPerWad.mul(2))

          const { calls: moveStablecoinCalls } = mockedBookKeeper.smocked.moveStablecoin
          expect(moveStablecoinCalls.length).to.be.equal(1)
          expect(moveStablecoinCalls[0].src).to.be.equal(deployerAddress)
          expect(moveStablecoinCalls[0].dst).to.be.equal(systemDebtEngineAddress)
          expect(moveStablecoinCalls[0].value).to.be.equal(WeiPerWad.mul(2).mul(price))

          const { calls: removeRepaidDebtFromAuctionCalls } =
            mockedLiquidationEngine.smocked.removeRepaidDebtFromAuction
          expect(removeRepaidDebtFromAuctionCalls.length).to.be.equal(1)
          expect(removeRepaidDebtFromAuctionCalls[0].collateralPoolId).to.be.equal(formatBytes32String("BTCB"))
          expect(removeRepaidDebtFromAuctionCalls[0].rad).to.be.equal(WeiPerRad.mul(120000))
        })
      })
    })
  })
})
