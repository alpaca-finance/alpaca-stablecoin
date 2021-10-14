import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import {
  BookKeeper__factory,
  PositionManager,
  PositionManager__factory,
  BookKeeper,
  TokenAdapter__factory,
  BEP20__factory,
  TokenAdapter,
  ShowStopper__factory,
  AccessControlConfig__factory,
  AccessControlConfig,
  CollateralPoolConfig__factory,
  CollateralPoolConfig,
} from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { parseEther, formatBytes32String } = ethers.utils

type fixture = {
  positionManager: PositionManager
  mockedBookKeeper: MockContract
  mockedDummyToken: MockContract
  mockedTokenAdapter: MockContract
  mockedShowStopper: MockContract
  mockedCollateralPoolConfig: MockContract
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  const AccessControlConfig = (await ethers.getContractFactory(
    "AccessControlConfig",
    deployer
  )) as AccessControlConfig__factory
  const accessControlConfig = (await upgrades.deployProxy(AccessControlConfig, [])) as AccessControlConfig
  const CollateralPoolConfig = (await ethers.getContractFactory(
    "CollateralPoolConfig",
    deployer
  )) as CollateralPoolConfig__factory
  const collateralPoolConfig = (await upgrades.deployProxy(CollateralPoolConfig, [
    accessControlConfig.address,
  ])) as CollateralPoolConfig
  const mockedCollateralPoolConfig = await smockit(collateralPoolConfig)

  // Deploy mocked BookKeeper
  const BookKeeper = (await ethers.getContractFactory("BookKeeper", deployer)) as BookKeeper__factory
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [
    collateralPoolConfig.address,
    accessControlConfig.address,
  ])) as BookKeeper
  await bookKeeper.deployed()
  const mockedBookKeeper = await smockit(bookKeeper)

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const dummyToken = await BEP20.deploy("dummy", "DUMP")
  await dummyToken.deployed()
  const mockedDummyToken = await smockit(dummyToken)

  // Deploy mocked TokenAdapter
  const TokenAdapter = (await ethers.getContractFactory("TokenAdapter", deployer)) as TokenAdapter__factory
  const tokenAdapter = (await upgrades.deployProxy(TokenAdapter, [
    mockedBookKeeper.address,
    formatBytes32String("DUMMY"),
    mockedDummyToken.address,
  ])) as TokenAdapter
  await tokenAdapter.deployed()
  const mockedTokenAdapter = await smockit(tokenAdapter)

  // Deploy mocked ShowStopper
  const ShowStopper = (await ethers.getContractFactory("ShowStopper", deployer)) as ShowStopper__factory
  const showStopper = await upgrades.deployProxy(ShowStopper, [mockedBookKeeper.address])
  await showStopper.deployed()
  const mockedShowStopper = await smockit(showStopper)

  // Deploy PositionManager
  const PositionManager = (await ethers.getContractFactory("PositionManager", deployer)) as PositionManager__factory
  const positionManager = (await upgrades.deployProxy(PositionManager, [
    mockedBookKeeper.address,
    mockedShowStopper.address,
  ])) as PositionManager
  await positionManager.deployed()

  return {
    positionManager,
    mockedBookKeeper,
    mockedDummyToken,
    mockedTokenAdapter,
    mockedShowStopper,
    mockedCollateralPoolConfig,
  }
}

describe("PositionManager", () => {
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
  let positionManager: PositionManager

  let mockedBookKeeper: MockContract
  let mockedDummyToken: MockContract
  let mockedTokenAdapter: MockContract
  let mockedShowStopper: MockContract
  let mockedCollateralPoolConfig: MockContract

  // Signer
  let positionManagerAsAlice: PositionManager
  let positionManagerAsBob: PositionManager

  beforeEach(async () => {
    ;({
      positionManager,
      mockedBookKeeper,
      mockedDummyToken,
      mockedTokenAdapter,
      mockedShowStopper,
      mockedCollateralPoolConfig,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])

    positionManagerAsAlice = PositionManager__factory.connect(positionManager.address, alice) as PositionManager
    positionManagerAsBob = PositionManager__factory.connect(positionManager.address, bob) as PositionManager
  })

  describe("#open()", () => {
    context("when supply zero address", () => {
      it("should revert", async () => {
        await expect(positionManager.open(formatBytes32String("BNB"), AddressZero)).to.be.revertedWith(
          "PositionManager/user-address(0)"
        )
      })
    })
    context("when collateral pool doesn't init", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(0)
        await expect(positionManager.open(formatBytes32String("BNB"), aliceAddress)).to.be.revertedWith(
          "PositionManager/collateralPool-not-init"
        )
      })
    })
    context("when parameters are valid", () => {
      it("should be able to open CDP with an incremental CDP index", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })

        expect(await positionManager.owners(1)).to.equal(AddressZero)
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        expect(await positionManager.lastPositionId()).to.bignumber.equal(1)
        expect(await positionManager.owners(1)).to.equal(aliceAddress)

        expect(await positionManager.owners(2)).to.equal(AddressZero)
        await positionManager.open(formatBytes32String("BNB"), bobAddress)
        expect(await positionManager.lastPositionId()).to.bignumber.equal(2)
        expect(await positionManager.owners(2)).to.equal(bobAddress)

        expect(await positionManager.owners(3)).to.equal(AddressZero)
        await positionManager.open(formatBytes32String("COL"), aliceAddress)
        expect(await positionManager.lastPositionId()).to.bignumber.equal(3)
        expect(await positionManager.owners(3)).to.equal(aliceAddress)
      })
    })
  })

  describe("#give()", () => {
    context("when caller has no access to the position (or have no allowance)", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(positionManager.give(1, aliceAddress)).to.be.revertedWith("owner not allowed")
      })
    })
    context("when input destination as zero address", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(positionManagerAsAlice.give(1, AddressZero)).to.be.revertedWith("destination address(0)")
      })
    })
    context("when input destination as current owner address", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(positionManagerAsAlice.give(1, aliceAddress)).to.be.revertedWith("destination already owner")
      })
    })
    context("when parameters are valid", () => {
      it("should be able to change the owner of CDP ", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        expect(await positionManager.owners(1)).to.equal(aliceAddress)
        await positionManagerAsAlice.give(1, bobAddress)
        expect(await positionManager.owners(1)).to.equal(bobAddress)
      })
    })
  })

  describe("#allowManagePosition()", () => {
    context("when caller has no access to the position (or have no allowance)", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(positionManager.allowManagePosition(1, aliceAddress, 1)).to.be.revertedWith("owner not allowed")
      })
    })
    context("when parameters are valid", () => {
      it("should be able to add user allowance to a position", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        expect(await positionManager.ownerWhitelist(aliceAddress, 1, bobAddress)).to.be.equal(0)
        await positionManagerAsAlice.allowManagePosition(1, bobAddress, 1)
        expect(await positionManager.ownerWhitelist(aliceAddress, 1, bobAddress)).to.be.equal(1)
      })
    })
  })

  describe("#allowMigratePosition()", () => {
    context("when parameters are valid", () => {
      it("should be able to give/revoke migration allowance to other address", async () => {
        expect(await positionManager.migrationWhitelist(aliceAddress, bobAddress)).to.be.equal(0)
        await positionManagerAsAlice.allowMigratePosition(bobAddress, 1)
        expect(await positionManager.migrationWhitelist(aliceAddress, bobAddress)).to.be.equal(1)
        await positionManagerAsAlice.allowMigratePosition(bobAddress, 0)
        expect(await positionManager.migrationWhitelist(aliceAddress, bobAddress)).to.be.equal(0)
      })
    })
  })

  describe("#list()", () => {
    context("when a few position has been opened", () => {
      it("should work as a linklist perfectly", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        // Alice open position 1-3
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)

        // Bob open position 4-7
        await positionManager.open(formatBytes32String("BNB"), bobAddress)
        await positionManager.open(formatBytes32String("BNB"), bobAddress)
        await positionManager.open(formatBytes32String("BNB"), bobAddress)
        await positionManager.open(formatBytes32String("BNB"), bobAddress)

        let [aliceCount, aliceFirst, aliceLast] = await Promise.all([
          positionManager.ownerPositionCount(aliceAddress),
          positionManager.ownerFirstPositionId(aliceAddress),
          positionManager.ownerLastPositionId(aliceAddress),
        ])
        expect(aliceCount).to.bignumber.equal(3)
        expect(aliceFirst).to.bignumber.equal(1)
        expect(aliceLast).to.bignumber.equal(3)
        expect(await positionManager.list(1)).to.be.deep.equal([BigNumber.from(0), BigNumber.from(2)])
        expect(await positionManager.list(2)).to.be.deep.equal([BigNumber.from(1), BigNumber.from(3)])
        expect(await positionManager.list(3)).to.be.deep.equal([BigNumber.from(2), BigNumber.from(0)])

        let [bobCount, bobFirst, bobLast] = await Promise.all([
          positionManager.ownerPositionCount(bobAddress),
          positionManager.ownerFirstPositionId(bobAddress),
          positionManager.ownerLastPositionId(bobAddress),
        ])
        expect(bobCount).to.bignumber.equal(4)
        expect(bobFirst).to.bignumber.equal(4)
        expect(bobLast).to.bignumber.equal(7)
        expect(await positionManager.list(4)).to.be.deep.equal([BigNumber.from(0), BigNumber.from(5)])
        expect(await positionManager.list(5)).to.be.deep.equal([BigNumber.from(4), BigNumber.from(6)])
        expect(await positionManager.list(6)).to.be.deep.equal([BigNumber.from(5), BigNumber.from(7)])
        expect(await positionManager.list(7)).to.be.deep.equal([BigNumber.from(6), BigNumber.from(0)])

        // try giving position 2 to Bob, the CDP#2 should be concat at the end of the link list
        await positionManagerAsAlice.give(2, bobAddress)
        ;[aliceCount, aliceFirst, aliceLast] = await Promise.all([
          positionManager.ownerPositionCount(aliceAddress),
          positionManager.ownerFirstPositionId(aliceAddress),
          positionManager.ownerLastPositionId(aliceAddress),
        ])
        expect(aliceCount).to.bignumber.equal(2)
        expect(aliceFirst).to.bignumber.equal(1)
        expect(aliceLast).to.bignumber.equal(3)
        expect(await positionManager.list(1)).to.be.deep.equal([BigNumber.from(0), BigNumber.from(3)])
        expect(await positionManager.list(3)).to.be.deep.equal([BigNumber.from(1), BigNumber.from(0)])
        ;[bobCount, bobFirst, bobLast] = await Promise.all([
          positionManager.ownerPositionCount(bobAddress),
          positionManager.ownerFirstPositionId(bobAddress),
          positionManager.ownerLastPositionId(bobAddress),
        ])
        expect(bobCount).to.bignumber.equal(5)
        expect(bobFirst).to.bignumber.equal(4)
        expect(bobLast).to.bignumber.equal(2) // CDP#2 concatted at the end of the list
        expect(await positionManager.list(4)).to.be.deep.equal([BigNumber.from(0), BigNumber.from(5)])
        expect(await positionManager.list(5)).to.be.deep.equal([BigNumber.from(4), BigNumber.from(6)])
        expect(await positionManager.list(6)).to.be.deep.equal([BigNumber.from(5), BigNumber.from(7)])
        expect(await positionManager.list(7)).to.be.deep.equal([BigNumber.from(6), BigNumber.from(2)])
        expect(await positionManager.list(2)).to.be.deep.equal([BigNumber.from(7), BigNumber.from(0)])
      })
    })
  })

  describe("#adjustPosition()", () => {
    context("when caller has no access to the position", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(
          positionManager.adjustPosition(1, parseEther("1"), parseEther("50"), mockedTokenAdapter.address, "0x")
        ).to.be.revertedWith("owner not allowed")
      })
    })
    context("when parameters are valid", async () => {
      it("should be able to call BookKeeper.adjustPosition", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        const positionAddress = await positionManager.positions(1)

        mockedBookKeeper.smocked.adjustPosition.will.return.with()
        await positionManagerAsAlice.adjustPosition(
          1,
          parseEther("1"),
          parseEther("50"),
          mockedTokenAdapter.address,
          "0x"
        )

        const { calls: bookKeeperCalls } = mockedBookKeeper.smocked.adjustPosition
        expect(bookKeeperCalls.length).to.be.equal(1)
        expect(bookKeeperCalls[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(bookKeeperCalls[0]._positionAddress).to.be.equal(positionAddress)
        expect(bookKeeperCalls[0]._collateralOwner).to.be.equal(positionAddress)
        expect(bookKeeperCalls[0]._stablecoinOwner).to.be.equal(positionAddress)
        expect(bookKeeperCalls[0]._collateralValue).to.be.equal(parseEther("1"))
        expect(bookKeeperCalls[0]._debtShare).to.be.equal(parseEther("50"))

        const { calls: tokenAdapterCalls } = mockedTokenAdapter.smocked.onAdjustPosition
        expect(tokenAdapterCalls.length).to.be.eq(1)
        expect(tokenAdapterCalls[0].src).to.be.equal(positionAddress)
        expect(tokenAdapterCalls[0].dst).to.be.equal(positionAddress)
        expect(tokenAdapterCalls[0].collateralValue).to.be.equal(parseEther("1"))
        expect(tokenAdapterCalls[0].debtShare).to.be.equal(parseEther("50"))
        expect(tokenAdapterCalls[0].data).to.be.equal("0x")
      })
    })
  })

  describe("#moveCollateral(uint256,address,uint256,address,bytes)", () => {
    context("when caller has no access to the position", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(
          positionManager["moveCollateral(uint256,address,uint256,address,bytes)"](
            1,
            aliceAddress,
            parseEther("50"),
            mockedTokenAdapter.address,
            "0x"
          )
        ).to.be.revertedWith("owner not allowed")
      })
    })
    context("when parameters are valid", async () => {
      it("should be able to call moveCollateral(uint256,address,uint256,address,bytes)", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        const positionAddress = await positionManager.positions(1)

        mockedBookKeeper.smocked.moveCollateral.will.return.with()
        await positionManagerAsAlice["moveCollateral(uint256,address,uint256,address,bytes)"](
          1,
          bobAddress,
          parseEther("1"),
          mockedTokenAdapter.address,
          "0x"
        )

        const { calls: bookKeeperCalls } = mockedBookKeeper.smocked.moveCollateral
        expect(bookKeeperCalls.length).to.be.equal(1)
        expect(bookKeeperCalls[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(bookKeeperCalls[0]._src).to.be.equal(positionAddress)
        expect(bookKeeperCalls[0]._dst).to.be.equal(bobAddress)
        expect(bookKeeperCalls[0]._amount).to.be.equal(parseEther("1"))

        const { calls: tokenAdapterCalls } = mockedTokenAdapter.smocked.onMoveCollateral
        expect(tokenAdapterCalls.length).to.be.equal(1)
        expect(tokenAdapterCalls[0].src).to.be.equal(positionAddress)
        expect(tokenAdapterCalls[0].dst).to.be.equal(bobAddress)
        expect(tokenAdapterCalls[0].wad).to.be.equal(parseEther("1"))
        expect(tokenAdapterCalls[0].data).to.be.equal("0x")
      })
    })
  })

  // This function has the purpose to take away collateral from the system that doesn't correspond to the position but was sent there wrongly.
  describe("#moveCollateral(bytes32,uint256,address,uint256,address,bytes)", () => {
    context("when caller has no access to the position", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(
          positionManager["moveCollateral(bytes32,uint256,address,uint256,address,bytes)"](
            formatBytes32String("BNB"),
            1,
            aliceAddress,
            parseEther("50"),
            mockedTokenAdapter.address,
            "0x"
          )
        ).to.be.revertedWith("owner not allowed")
      })
    })
    context("when parameters are valid", async () => {
      it("should be able to call moveCollateral(bytes32,uint256,address,uint256,address,bytes)", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        const positionAddress = await positionManager.positions(1)

        mockedBookKeeper.smocked.moveCollateral.will.return.with()
        await positionManagerAsAlice["moveCollateral(bytes32,uint256,address,uint256,address,bytes)"](
          formatBytes32String("BNB"),
          1,
          bobAddress,
          parseEther("1"),
          mockedTokenAdapter.address,
          "0x"
        )

        const { calls: bookKeeperCalls } = mockedBookKeeper.smocked.moveCollateral
        expect(bookKeeperCalls.length).to.be.equal(1)
        expect(bookKeeperCalls[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(bookKeeperCalls[0]._src).to.be.equal(positionAddress)
        expect(bookKeeperCalls[0]._dst).to.be.equal(bobAddress)
        expect(bookKeeperCalls[0]._amount).to.be.equal(parseEther("1"))

        const { calls: tokenAdapterCalls } = mockedTokenAdapter.smocked.onMoveCollateral
        expect(tokenAdapterCalls[0].src).to.be.equal(positionAddress)
        expect(tokenAdapterCalls[0].dst).to.be.equal(bobAddress)
        expect(tokenAdapterCalls[0].wad).to.be.equal(parseEther("1"))
        expect(tokenAdapterCalls[0].data).to.be.equal("0x")
      })
    })
  })

  describe("#moveStablecoin()", () => {
    context("when caller has no access to the position", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(positionManager.moveStablecoin(1, bobAddress, WeiPerRad.mul(10))).to.be.revertedWith(
          "owner not allowed"
        )
      })
    })
    context("when parameters are valid", async () => {
      it("should be able to call moveStablecoin()", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        const positionAddress = await positionManager.positions(1)

        mockedBookKeeper.smocked.moveStablecoin.will.return.with()
        await positionManagerAsAlice.moveStablecoin(1, bobAddress, WeiPerRad.mul(10))

        const { calls } = mockedBookKeeper.smocked.moveStablecoin
        expect(calls.length).to.be.equal(1)
        expect(calls[0]._src).to.be.equal(positionAddress)
        expect(calls[0]._dst).to.be.equal(bobAddress)
        expect(calls[0]._value).to.be.equal(WeiPerRad.mul(10))
      })
    })
  })

  describe("#exportPosition()", () => {
    context("when caller has no access to the position", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(positionManagerAsBob.exportPosition(1, bobAddress)).to.be.revertedWith("owner not allowed")
      })
    })
    context("when destination (Bob) has no migration access on caller (Alice)", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await positionManagerAsAlice.allowManagePosition(1, bobAddress, 1)
        await expect(positionManagerAsAlice.exportPosition(1, bobAddress)).to.be.revertedWith("migration not allowed")
      })
    })
    context("when Alice wants to export her own position to her own address", async () => {
      it("should be able to call exportPosition()", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        const positionAddress = await positionManager.positions(1)

        mockedBookKeeper.smocked.positions.will.return.with([WeiPerWad.mul(2), WeiPerWad.mul(1)])
        mockedBookKeeper.smocked.movePosition.will.return.with()

        await positionManagerAsAlice.exportPosition(1, aliceAddress)

        const { calls: positionsCalls } = mockedBookKeeper.smocked.positions
        const { calls: movePositionCalls } = mockedBookKeeper.smocked.movePosition

        expect(positionsCalls.length).to.be.equal(1)
        expect(positionsCalls[0][0]).to.be.equal(formatBytes32String("BNB"))
        expect(positionsCalls[0][1]).to.be.equal(positionAddress)

        expect(movePositionCalls.length).to.be.equal(1)
        expect(movePositionCalls[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(movePositionCalls[0]._src).to.be.equal(positionAddress)
        expect(movePositionCalls[0]._dst).to.be.equal(aliceAddress)
        expect(movePositionCalls[0]._collateralAmount).to.be.equal(WeiPerWad.mul(2))
        expect(movePositionCalls[0]._debtShare).to.be.equal(WeiPerWad.mul(1))
      })
    })
    context("when Alice wants Bob to export her position to Bob's address", async () => {
      it("should be able to call exportPosition()", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        const positionAddress = await positionManager.positions(1)

        // Alice allows Bob to manage her position#1
        await positionManagerAsAlice.allowManagePosition(1, bobAddress, 1)

        mockedBookKeeper.smocked.positions.will.return.with([WeiPerWad.mul(2), WeiPerWad.mul(1)])
        mockedBookKeeper.smocked.movePosition.will.return.with()

        // Bob exports position#1 to his address
        await positionManagerAsBob.exportPosition(1, bobAddress)

        const { calls: positionsCalls } = mockedBookKeeper.smocked.positions
        const { calls: movePositionCalls } = mockedBookKeeper.smocked.movePosition

        expect(positionsCalls.length).to.be.equal(1)
        expect(positionsCalls[0][0]).to.be.equal(formatBytes32String("BNB"))
        expect(positionsCalls[0][1]).to.be.equal(positionAddress)

        expect(movePositionCalls.length).to.be.equal(1)
        expect(movePositionCalls[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(movePositionCalls[0]._src).to.be.equal(positionAddress)
        expect(movePositionCalls[0]._dst).to.be.equal(bobAddress)
        expect(movePositionCalls[0]._collateralAmount).to.be.equal(WeiPerWad.mul(2))
        expect(movePositionCalls[0]._debtShare).to.be.equal(WeiPerWad.mul(1))
      })
    })
  })

  describe("#importPosition()", () => {
    context("when caller (Bob) has no migration access on source address (Alice)", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(positionManagerAsBob.importPosition(aliceAddress, 1)).to.be.revertedWith("migration not allowed")
      })
    })
    context("when caller has no access to the position", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        // Alice gives Bob migration access on her address
        await positionManagerAsAlice.allowMigratePosition(bobAddress, 1)
        await expect(positionManagerAsBob.importPosition(aliceAddress, 1)).to.be.revertedWith("owner not allowed")
      })
    })
    context("when Alice wants to import her own position from her address", async () => {
      it("should be able to call importPosition()", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        const positionAddress = await positionManager.positions(1)

        mockedBookKeeper.smocked.positions.will.return.with([WeiPerWad.mul(2), WeiPerWad.mul(1)])
        mockedBookKeeper.smocked.movePosition.will.return.with()

        await positionManagerAsAlice.importPosition(aliceAddress, 1)

        const { calls: positionsCalls } = mockedBookKeeper.smocked.positions
        const { calls: movePositionCalls } = mockedBookKeeper.smocked.movePosition

        expect(positionsCalls.length).to.be.equal(1)
        expect(positionsCalls[0][0]).to.be.equal(formatBytes32String("BNB"))
        expect(positionsCalls[0][1]).to.be.equal(aliceAddress)

        expect(movePositionCalls.length).to.be.equal(1)
        expect(movePositionCalls[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(movePositionCalls[0]._src).to.be.equal(aliceAddress)
        expect(movePositionCalls[0]._dst).to.be.equal(positionAddress)
        expect(movePositionCalls[0]._collateralAmount).to.be.equal(WeiPerWad.mul(2))
        expect(movePositionCalls[0]._debtShare).to.be.equal(WeiPerWad.mul(1))
      })
    })
    context("when Alice wants Bob to import her position from Bob's address", async () => {
      it("should be able to call importPosition()", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        const positionAddress = await positionManager.positions(1)

        // Alice allows Bob to manage her position#1
        await positionManagerAsAlice.allowManagePosition(1, bobAddress, 1)
        // Alice gives Bob migration access on her address
        await positionManagerAsAlice.allowMigratePosition(bobAddress, 1)

        mockedBookKeeper.smocked.positions.will.return.with([WeiPerWad.mul(2), WeiPerWad.mul(1)])
        mockedBookKeeper.smocked.movePosition.will.return.with()

        // Bob imports position#1 from his address to position#1
        await positionManagerAsBob.importPosition(bobAddress, 1)

        const { calls: positionsCalls } = mockedBookKeeper.smocked.positions
        const { calls: movePositionCalls } = mockedBookKeeper.smocked.movePosition

        expect(positionsCalls.length).to.be.equal(1)
        expect(positionsCalls[0][0]).to.be.equal(formatBytes32String("BNB"))
        expect(positionsCalls[0][1]).to.be.equal(bobAddress)

        expect(movePositionCalls.length).to.be.equal(1)
        expect(movePositionCalls[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(movePositionCalls[0]._src).to.be.equal(bobAddress)
        expect(movePositionCalls[0]._dst).to.be.equal(positionAddress)
        expect(movePositionCalls[0]._collateralAmount).to.be.equal(WeiPerWad.mul(2))
        expect(movePositionCalls[0]._debtShare).to.be.equal(WeiPerWad.mul(1))
      })
    })
  })

  describe("#movePosition()", () => {
    context("when caller (Bob) has no access to the source position", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await positionManager.open(formatBytes32String("BNB"), bobAddress)

        await expect(positionManagerAsBob.movePosition(1, 2)).to.be.revertedWith("owner not allowed")
      })
    })
    context("when caller (Alice) has no access to the destination position", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await positionManager.open(formatBytes32String("BNB"), bobAddress)

        await expect(positionManagerAsAlice.movePosition(1, 2)).to.be.revertedWith("owner not allowed")
      })
    })
    context("when these two positions are from different collateral pool", () => {
      it("should revert", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await positionManager.open(formatBytes32String("BTC"), bobAddress)
        await positionManagerAsBob.allowManagePosition(2, aliceAddress, 1)

        await expect(positionManagerAsAlice.movePosition(1, 2)).to.be.revertedWith("!same collateral pool")
      })
    })
    context("when Alice wants to move her position#1 to her position#2", async () => {
      it("should be able to call movePosition()", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        const position1Address = await positionManager.positions(1)
        const position2Address = await positionManager.positions(2)

        mockedBookKeeper.smocked.positions.will.return.with([WeiPerWad.mul(2), WeiPerWad.mul(1)])
        mockedBookKeeper.smocked.movePosition.will.return.with()

        await positionManagerAsAlice.movePosition(1, 2)

        const { calls: positionsCalls } = mockedBookKeeper.smocked.positions
        const { calls: movePositionCalls } = mockedBookKeeper.smocked.movePosition

        expect(positionsCalls.length).to.be.equal(1)
        expect(positionsCalls[0][0]).to.be.equal(formatBytes32String("BNB"))
        expect(positionsCalls[0][1]).to.be.equal(position1Address)

        expect(movePositionCalls.length).to.be.equal(1)
        expect(movePositionCalls[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(movePositionCalls[0]._src).to.be.equal(position1Address)
        expect(movePositionCalls[0]._dst).to.be.equal(position2Address)
        expect(movePositionCalls[0]._collateralAmount).to.be.equal(WeiPerWad.mul(2))
        expect(movePositionCalls[0]._debtShare).to.be.equal(WeiPerWad.mul(1))
      })
    })
    context("when Alice wants to move her position#1 to Bob's position#2", async () => {
      it("should be able to call movePosition()", async () => {
        mockedBookKeeper.smocked.collateralPoolConfig.will.return.with(mockedCollateralPoolConfig.address)
        mockedCollateralPoolConfig.smocked.getDebtAccumulatedRate.will.return.with(WeiPerRay)
        mockedCollateralPoolConfig.smocked.collateralPools.will.return.with({
          totalDebtShare: 0,
          debtAccumulatedRate: WeiPerRay,
          priceWithSafetyMargin: WeiPerRay,
          debtCeiling: 0,
          debtFloor: 0,
          priceFeed: AddressZero,
          liquidationRatio: WeiPerRay,
          stabilityFeeRate: WeiPerRay,
          lastAccumulationTime: 0,
          adapter: AddressZero,
          closeFactorBps: 5000,
          liquidatorIncentiveBps: 10250,
          treasuryFeesBps: 5000,
          strategy: AddressZero,
        })
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await positionManager.open(formatBytes32String("BNB"), bobAddress)
        await positionManagerAsBob.allowManagePosition(2, aliceAddress, 1)
        const position1Address = await positionManager.positions(1)
        const position2Address = await positionManager.positions(2)

        mockedBookKeeper.smocked.positions.will.return.with([WeiPerWad.mul(2), WeiPerWad.mul(1)])
        mockedBookKeeper.smocked.movePosition.will.return.with()

        await positionManagerAsAlice.movePosition(1, 2)

        const { calls: positionsCalls } = mockedBookKeeper.smocked.positions
        const { calls: movePositionCalls } = mockedBookKeeper.smocked.movePosition

        expect(positionsCalls.length).to.be.equal(1)
        expect(positionsCalls[0][0]).to.be.equal(formatBytes32String("BNB"))
        expect(positionsCalls[0][1]).to.be.equal(position1Address)

        expect(movePositionCalls.length).to.be.equal(1)
        expect(movePositionCalls[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(movePositionCalls[0]._src).to.be.equal(position1Address)
        expect(movePositionCalls[0]._dst).to.be.equal(position2Address)
        expect(movePositionCalls[0]._collateralAmount).to.be.equal(WeiPerWad.mul(2))
        expect(movePositionCalls[0]._debtShare).to.be.equal(WeiPerWad.mul(1))
      })
    })
  })

  describe("#redeemLockedCollateral()", () => {
    context("when caller has no access to the position (or have no allowance)", () => {
      it("should revert", async () => {
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(
          positionManager.redeemLockedCollateral(1, mockedTokenAdapter.address, aliceAddress, "0x")
        ).to.be.revertedWith("owner not allowed")
      })
    })
    context("when parameters are valid", () => {
      it("should be able to redeemLockedCollateral", async () => {
        await positionManager.open(formatBytes32String("BNB"), aliceAddress)
        const position1Address = await positionManager.positions(1)
        await positionManagerAsAlice.redeemLockedCollateral(1, mockedTokenAdapter.address, aliceAddress, "0x")

        const { calls: redeemLockedCollateralCalls } = mockedShowStopper.smocked.redeemLockedCollateral
        expect(redeemLockedCollateralCalls.length).to.be.equal(1)
        expect(redeemLockedCollateralCalls[0][0]).to.be.equal(formatBytes32String("BNB"))
        expect(redeemLockedCollateralCalls[0][1]).to.be.equal(mockedTokenAdapter.address)
        expect(redeemLockedCollateralCalls[0][2]).to.be.equal(position1Address)
        expect(redeemLockedCollateralCalls[0][3]).to.be.equal(aliceAddress)
        expect(redeemLockedCollateralCalls[0][4]).to.be.equal("0x")
      })
    })
  })
})
