import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import {
  BookKeeper__factory,
  PositionManager,
  BookKeeper,
  BEP20__factory,
  IbTokenAdapter__factory,
  IbTokenAdapter,
  AlpacaToken__factory,
  FairLaunch__factory,
  Shield__factory,
  Timelock__factory,
  BEP20,
  Shield,
  Timelock,
  AlpacaToken,
  FairLaunch,
} from "../../../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"
import { WeiPerRad, WeiPerRay, WeiPerWad, weiToRay } from "../../../../helper/unit"
import { advanceBlock } from "../../../../helper/time"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { parseEther, formatBytes32String } = ethers.utils

type fixture = {
  ibTokenAdapter: IbTokenAdapter
  bookKeeper: BookKeeper
  ibDUMMY: BEP20
  shield: Shield
  timelock: Timelock
  alpacaToken: AlpacaToken
  fairLaunch: FairLaunch
}

const ALPACA_PER_BLOCK = ethers.utils.parseEther("100")
const COLLATERAL_POOL_ID = formatBytes32String("ibDUMMY")

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer, alice, bob, dev] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const BookKeeper = (await ethers.getContractFactory("BookKeeper", deployer)) as BookKeeper__factory
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [])) as BookKeeper
  await bookKeeper.deployed()

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const ibDUMMY = await BEP20.deploy("ibDUMMY", "ibDUMMY")
  await ibDUMMY.deployed()
  await ibDUMMY.mint(await alice.getAddress(), ethers.utils.parseEther("100"))
  await ibDUMMY.mint(await bob.getAddress(), ethers.utils.parseEther("100"))

  // Deploy Alpaca's Fairlaunch
  const AlpacaToken = (await ethers.getContractFactory("AlpacaToken", deployer)) as AlpacaToken__factory
  const alpacaToken = await AlpacaToken.deploy(88, 89)
  await alpacaToken.deployed()

  const FairLaunch = (await ethers.getContractFactory("FairLaunch", deployer)) as FairLaunch__factory
  const fairLaunch = await FairLaunch.deploy(alpacaToken.address, await dev.getAddress(), ALPACA_PER_BLOCK, 0, 0, 0)
  await fairLaunch.deployed()

  const Shield = (await ethers.getContractFactory("Shield", deployer)) as Shield__factory
  const shield = await Shield.deploy(deployer.address, fairLaunch.address)
  await shield.deployed()

  const Timelock = (await ethers.getContractFactory("Timelock", deployer)) as Timelock__factory
  const timelock = await Timelock.deploy(deployer.address, 86400)
  await timelock.deployed()

  // Config Alpaca's FairLaunch
  await fairLaunch.addPool(1, ibDUMMY.address, true)
  await fairLaunch.transferOwnership(shield.address)
  await shield.transferOwnership(timelock.address)
  await alpacaToken.transferOwnership(fairLaunch.address)

  const IbTokenAdapter = (await ethers.getContractFactory("IbTokenAdapter", deployer)) as IbTokenAdapter__factory
  const ibTokenAdapter = (await upgrades.deployProxy(IbTokenAdapter, [
    bookKeeper.address,
    COLLATERAL_POOL_ID,
    ibDUMMY.address,
    alpacaToken.address,
    fairLaunch.address,
    0,
    shield.address,
    timelock.address,
  ])) as IbTokenAdapter
  await ibTokenAdapter.deployed()

  await bookKeeper.rely(ibTokenAdapter.address)

  return {
    ibTokenAdapter,
    bookKeeper,
    ibDUMMY,
    shield,
    timelock,
    alpacaToken,
    fairLaunch,
  }
}

describe("IbTokenAdapter", () => {
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
  let ibTokenAdapter: IbTokenAdapter
  let bookKeeper: BookKeeper
  let ibDUMMY: BEP20
  let shield: Shield
  let timelock: Timelock
  let alpacaToken: AlpacaToken
  let fairLaunch: FairLaunch

  // Signer
  let ibTokenAdapterAsAlice: IbTokenAdapter
  let ibTokenAdapterAsBob: IbTokenAdapter

  let ibDUMMYasAlice: BEP20
  let ibDUMMYasBob: BEP20

  beforeEach(async () => {
    ;({ ibTokenAdapter, bookKeeper, ibDUMMY, shield, timelock, alpacaToken, fairLaunch } = await waffle.loadFixture(
      loadFixtureHandler
    ))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])

    ibTokenAdapterAsAlice = IbTokenAdapter__factory.connect(ibTokenAdapter.address, alice)
    ibTokenAdapterAsBob = IbTokenAdapter__factory.connect(ibTokenAdapter.address, bob)

    ibDUMMYasAlice = BEP20__factory.connect(ibDUMMY.address, alice)
    ibDUMMYasBob = BEP20__factory.connect(ibDUMMY.address, bob)
  })

  describe("#initialize", async () => {
    context("when collateralToken not match with FairLaunch", async () => {
      it("should revert", async () => {
        const IbTokenAdapter = (await ethers.getContractFactory("IbTokenAdapter", deployer)) as IbTokenAdapter__factory
        await expect(
          upgrades.deployProxy(IbTokenAdapter, [
            bookKeeper.address,
            COLLATERAL_POOL_ID,
            alpacaToken.address,
            alpacaToken.address,
            fairLaunch.address,
            0,
            shield.address,
            timelock.address,
          ])
        ).to.be.revertedWith("IbTokenAdapter/collateralToken-not-match")
      })
    })

    context("when rewardToken not match with FairLaunch", async () => {
      it("should revert", async () => {
        const IbTokenAdapter = (await ethers.getContractFactory("IbTokenAdapter", deployer)) as IbTokenAdapter__factory
        await expect(
          upgrades.deployProxy(IbTokenAdapter, [
            bookKeeper.address,
            COLLATERAL_POOL_ID,
            ibDUMMY.address,
            ibDUMMY.address,
            fairLaunch.address,
            0,
            shield.address,
            timelock.address,
          ])
        ).to.be.revertedWith("IbTokenAdapter/reward-token-not-match")
      })
    })

    context("when shield not match with FairLaunch", async () => {
      it("should revert", async () => {
        const IbTokenAdapter = (await ethers.getContractFactory("IbTokenAdapter", deployer)) as IbTokenAdapter__factory
        await expect(
          upgrades.deployProxy(IbTokenAdapter, [
            bookKeeper.address,
            COLLATERAL_POOL_ID,
            ibDUMMY.address,
            alpacaToken.address,
            fairLaunch.address,
            0,
            deployerAddress,
            timelock.address,
          ])
        ).to.be.revertedWith("IbTokenAdapter/shield-not-match")
      })
    })

    context("when timelock not match with FairLaunch", async () => {
      it("should revert", async () => {
        const IbTokenAdapter = (await ethers.getContractFactory("IbTokenAdapter", deployer)) as IbTokenAdapter__factory
        await expect(
          upgrades.deployProxy(IbTokenAdapter, [
            bookKeeper.address,
            COLLATERAL_POOL_ID,
            ibDUMMY.address,
            alpacaToken.address,
            fairLaunch.address,
            0,
            shield.address,
            deployerAddress,
          ])
        ).to.be.revertedWith("IbTokenAdapter/timelock-not-match")
      })
    })

    context("when all assumptions are correct", async () => {
      it("should initalized correctly", async () => {
        expect(await ibTokenAdapter.bookKeeper()).to.be.eq(bookKeeper.address)
        expect(await ibTokenAdapter.collateralPoolId()).to.be.eq(COLLATERAL_POOL_ID)
        expect(await ibTokenAdapter.collateralToken()).to.be.eq(ibDUMMY.address)
        expect(await ibTokenAdapter.fairlaunch()).to.be.eq(fairLaunch.address)
        expect(await ibTokenAdapter.pid()).to.be.eq(0)
        expect(await ibTokenAdapter.shield()).to.be.eq(shield.address)
        expect(await ibTokenAdapter.timelock()).to.be.eq(timelock.address)
        expect(await ibTokenAdapter.whitelist(deployerAddress)).to.be.bignumber.eq(1)
        expect(await ibTokenAdapter.decimals()).to.be.eq(18)
      })
    })
  })

  describe("#deposit", async () => {
    context("when IbTokenAdapter is not live", async () => {
      it("should revert", async () => {
        // Cage ibTokenAdapter
        await ibTokenAdapter.cage()
        await expect(
          ibTokenAdapter.deposit(
            deployerAddress,
            ethers.utils.parseEther("1"),
            ethers.utils.defaultAbiCoder.encode(["address"], [deployerAddress])
          )
        ).to.be.revertedWith("BaseFarmableToken/not live")
      })
    })

    context("when all parameters are valid", async () => {
      it("should work", async () => {
        // Assuming Alice is the first one to deposit hence no rewards to be harvested yet
        await ibDUMMYasAlice.approve(ibTokenAdapter.address, ethers.utils.parseEther("1"))
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)

        // Now Alice harvest rewards. 1 block has been passed, hence Alice should get 100 ALPACA
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          0,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("100"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("100")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("0"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(ethers.utils.parseEther("100"))

        // Bob join the party! As 2 blocks moved. IbTokenAdapter earned 200 ALPACA
        await ibDUMMYasBob.approve(ibTokenAdapter.address, ethers.utils.parseEther("4"))
        await ibTokenAdapterAsBob.deposit(
          bobAddress,
          ethers.utils.parseEther("4"),
          ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress])
        )

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("100"))
        expect(await alpacaToken.balanceOf(bobAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("5"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("300")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(ethers.utils.parseEther("100"))
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("1200"))

        // Bob harvest ALPACA. IbTokenAdapter earned another 100 ALPACA.
        // IbTokenAdapter has another 100 ALPACA from previous block. Hence,
        // balanceOf(address(this)) should return 300 ALPACA.
        // Bob should get 80 ALPACA.
        await ibTokenAdapterAsBob.deposit(bobAddress, 0, ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]))

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("220"))
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("100"))
        expect(await alpacaToken.balanceOf(bobAddress)).to.be.eq(ethers.utils.parseEther("80"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("5"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("320")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("220"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(ethers.utils.parseEther("100"))
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("1280"))
      })
    })
  })

  describe("#withdraw", async () => {
    context("when withdraw more than what IbTokenAdapter staked", async () => {
      it("should revert", async () => {
        await ibDUMMYasAlice.approve(ibTokenAdapter.address, ethers.utils.parseEther("1"))
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        await expect(
          ibTokenAdapterAsAlice.withdraw(
            aliceAddress,
            ethers.utils.parseEther("100"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
          )
        ).to.be.revertedWith("withdraw: not good")
      })
    })

    context("when withdraw more than what he staked", async () => {
      it("should revert", async () => {
        await ibDUMMYasAlice.approve(ibTokenAdapter.address, ethers.utils.parseEther("1"))
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        await ibDUMMYasBob.approve(ibTokenAdapter.address, ethers.utils.parseEther("4"))
        await ibTokenAdapterAsBob.deposit(
          bobAddress,
          ethers.utils.parseEther("4"),
          ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress])
        )

        await expect(
          ibTokenAdapterAsAlice.withdraw(
            aliceAddress,
            ethers.utils.parseEther("2"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
          )
        ).to.be.revertedWith("BaseFarmableToken/insufficient staked amount")
      })
    })

    context("when IbTokenAdapter is not live", async () => {
      it("should still allow user to withdraw", async () => {
        // Assuming Alice is the first one to deposit hence no rewards to be harvested yet
        await ibDUMMYasAlice.approve(ibTokenAdapter.address, ethers.utils.parseEther("1"))
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)

        // Cage IbTokenAdapter
        await ibTokenAdapter.cage()
        expect(await ibTokenAdapter.live()).to.be.eq(0)

        // Now Alice withdraw her position. 4 blocks have been passed.
        // IbTokenAdapter is caged, non of ALPACA has been harvested.
        // Staked collateralTokens have been emergencyWithdraw from FairLaunch.
        // The following conditions must be satisfy:
        // - Alice should get 0 ALPACA as cage before ALPACA get harvested.
        // - Alice should get 1 ibDUMMY back.
        let aliceIbDUMMYbefore = await ibDUMMY.balanceOf(aliceAddress)
        await ibTokenAdapterAsAlice.withdraw(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )
        let aliceIbDUMMYafter = await ibDUMMY.balanceOf(aliceAddress)

        expect(aliceIbDUMMYafter.sub(aliceIbDUMMYbefore)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await fairLaunch.pendingAlpaca(0, ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
      })

      it("should still allow user to withdraw with pending rewards (if any)", async () => {
        // Assuming Alice is the first one to deposit hence no rewards to be harvested yet
        await ibDUMMYasAlice.approve(ibTokenAdapter.address, ethers.utils.parseEther("1"))
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)

        // Bob join the party with 4 ibDUMMY! 2 Blocks have been passed.
        // IbTokenAdapter should earned 200 ALPACA
        await ibDUMMYasBob.approve(ibTokenAdapter.address, ethers.utils.parseEther("4"))
        await ibTokenAdapterAsBob.deposit(
          bobAddress,
          ethers.utils.parseEther("4"),
          ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress])
        )

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(bobAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("5"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("200")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("800"))

        // Move 1 block so IbTokenAdapter make 100 ALPACA. However this portion
        // won't be added as IbTokenAdapter cage before it get harvested.
        await advanceBlock()

        // Cage IbTokenAdapter
        await ibTokenAdapter.cage()
        expect(await ibTokenAdapter.live()).to.be.eq(0)

        // Now Alice withdraw her position. Only 200 ALPACA has been harvested from FairLaunch.
        // IbTokenAdapter is caged. Staked collateralTokens have been emergencyWithdraw from FairLaunch.
        // The following conditions must be satisfy:
        // - Alice pending rewards must be 200 ALPACA
        // - Bob pending rewards must be 0 ALPACA as all rewards after Bob deposited hasn't been harvested.
        // - Alice should get 200 ALPACA that is harvested before cage (when Bob deposited)
        // - Alice should get 1 ibDUMMY back.
        expect(await ibTokenAdapter.pendingRewards(aliceAddress)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.pendingRewards(bobAddress)).to.be.eq(0)

        let aliceIbDUMMYbefore = await ibDUMMY.balanceOf(aliceAddress)
        await ibTokenAdapterAsAlice.withdraw(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )
        let aliceIbDUMMYafter = await ibDUMMY.balanceOf(aliceAddress)

        expect(aliceIbDUMMYafter.sub(aliceIbDUMMYbefore)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await fairLaunch.pendingAlpaca(0, ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("200")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("800"))

        let bobIbDUMMYbefore = await ibDUMMY.balanceOf(bobAddress)
        await ibTokenAdapterAsBob.withdraw(
          bobAddress,
          ethers.utils.parseEther("4"),
          ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress])
        )
        let bobIbDUMMYafter = await ibDUMMY.balanceOf(bobAddress)

        expect(bobIbDUMMYafter.sub(bobIbDUMMYbefore)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await fairLaunch.pendingAlpaca(0, ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("200")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(0)
      })
    })

    context("when all parameters are valid", async () => {
      it("should work", async () => {
        // Assuming Alice is the first one to deposit hence no rewards to be harvested yet
        await ibDUMMYasAlice.approve(ibTokenAdapter.address, ethers.utils.parseEther("1"))
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)

        // Now Alice withdraw her position. 1 block has been passed, hence Alice should get 100 ALPACA
        let aliceIbDUMMYbefore = await ibDUMMY.balanceOf(aliceAddress)
        await ibTokenAdapterAsAlice.withdraw(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )
        let aliceIbDUMMYafter = await ibDUMMY.balanceOf(aliceAddress)

        expect(aliceIbDUMMYafter.sub(aliceIbDUMMYbefore)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("100"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("100")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
      })
    })
  })

  describe("#pendingRewards", async () => {
    context("when IbTokenAdapter doesn't has any collateralTokens", async () => {
      it("should returns 0 pending ALPACA", async () => {
        expect(await ibTokenAdapter.pendingRewards(deployerAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.pendingRewards(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.pendingRewards(bobAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.pendingRewards(devAddress)).to.be.eq(0)
      })
    })

    context("when IbToken is not live", async () => {
      it("should return correct pending ALPACA for each user", async () => {
        // Assuming Alice is the first one to deposit hence no rewards to be harvested yet
        await ibDUMMYasAlice.approve(ibTokenAdapter.address, ethers.utils.parseEther("1"))
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)

        // Bob deposit to ibTokenAdapter, 2 blocks have passed. Hence ibTokenAdapter should earned 200 ALPACA.
        await ibDUMMYasBob.approve(ibTokenAdapter.address, ethers.utils.parseEther("4"))
        await ibTokenAdapterAsBob.deposit(
          bobAddress,
          ethers.utils.parseEther("4"),
          ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress])
        )

        // The following conditions must be satisfy:
        // - ibTokenAdapter must has 200 ALPACA as deposit trigger harvest
        // - ibTokenAdapter.totalShare() must be 5 as Alice deposited 1 ibDUMMY + Bob deposited 4 ibDUMMY
        // - ibTokenAdapter.accRewardPerShare() must be 200 as 0 + (2*100)/1 = 200
        // - ibTokenAdapter.accRewardBalance() must be 200 as none of the rewards have been harvested
        // - ibTokenAdapter.stake(alice) must be 1 ibDUMMY
        // - ibTokenAdapter.rewardDebts(alice) must be 0
        // - ibTokenAdapter.stake(bob) must be 4 ibDUMMY
        // - ibTokenAdapter.rewardDebts(bob) must be 800
        // - ibTokenAdapter.pendingRewards(alice) must be 200 ALPACA as she deposited 2 block ago
        // - ibTokenAdapter.pendingRewards(bob) must be 0 ALPACA as he just deposited this block
        // - ibTokenAdapter.pendingRewards(deployer) must be 0 ALPACA as he doesn't do anything
        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("5"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("200")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("800"))

        expect(await ibTokenAdapter.pendingRewards(aliceAddress)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.pendingRewards(bobAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.pendingRewards(deployerAddress)).to.be.eq(0)

        // Cage ibTokenAdapter
        await ibTokenAdapter.cage()
        expect(await ibTokenAdapter.live()).to.be.eq(0)

        expect(await ibTokenAdapter.pendingRewards(aliceAddress)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.pendingRewards(bobAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.pendingRewards(deployerAddress)).to.be.eq(0)
      })
    })

    context("when multiple users use IbTokenAdapter", async () => {
      it("should returns correct pending ALPACA for each user", async () => {
        // Assuming Alice is the first one to deposit hence no rewards to be harvested yet
        await ibDUMMYasAlice.approve(ibTokenAdapter.address, ethers.utils.parseEther("1"))
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)

        // Bob deposit to ibTokenAdapter, 2 blocks have passed. Hence ibTokenAdapter should earned 200 ALPACA.
        await ibDUMMYasBob.approve(ibTokenAdapter.address, ethers.utils.parseEther("4"))
        await ibTokenAdapterAsBob.deposit(
          bobAddress,
          ethers.utils.parseEther("4"),
          ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress])
        )

        // The following conditions must be satisfy:
        // - ibTokenAdapter must has 200 ALPACA as deposit trigger harvest
        // - ibTokenAdapter.totalShare() must be 5 as Alice deposited 1 ibDUMMY + Bob deposited 4 ibDUMMY
        // - ibTokenAdapter.accRewardPerShare() must be 200 as 0 + (2*100)/1 = 200
        // - ibTokenAdapter.accRewardBalance() must be 200 as none of the rewards have been harvested
        // - ibTokenAdapter.stake(alice) must be 1 ibDUMMY
        // - ibTokenAdapter.rewardDebts(alice) must be 0
        // - ibTokenAdapter.stake(bob) must be 4 ibDUMMY
        // - ibTokenAdapter.rewardDebts(bob) must be 800
        // - ibTokenAdapter.pendingRewards(alice) must be 200 ALPACA as she deposited 2 block ago
        // - ibTokenAdapter.pendingRewards(bob) must be 0 ALPACA as he just deposited this block
        // - ibTokenAdapter.pendingRewards(deployer) must be 0 ALPACA as he doesn't do anything
        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("5"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("200")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("800"))

        expect(await ibTokenAdapter.pendingRewards(aliceAddress)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.pendingRewards(bobAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.pendingRewards(deployerAddress)).to.be.eq(0)

        // Move 1 Block to make FairLaunch produces 100 ALPACA
        await advanceBlock()

        // The following conditions must be satisfy:
        // - ibTokenAdapter must has 200 ALPACA as no interaction to IbTokenAdapter, hence ALPACA balance still the same
        // - ibTokenAdapter.totalShare() must be 5 as Alice deposited 1 ibDUMMY + Bob deposited 4 ibDUMMY
        // - ibTokenAdapter.accRewardPerShare() must be 200 as no interaction to IbTokenAdapter, hence value still the same
        // - ibTokenAdapter.accRewardBalance() must be 200 as no interaction to IbTokenAdapter, hence value still the same
        // - ibTokenAdapter.stake(alice) must be 1 ibDUMMY
        // - ibTokenAdapter.rewardDebts(alice) must be 0
        // - ibTokenAdapter.stake(bob) must be 4 ibDUMMY
        // - ibTokenAdapter.rewardDebts(bob) must be 800
        // - ibTokenAdapter.pendingRewards(alice) must be 200 ALPACA + 100 * (1/5) = 220 ALPACA
        // - ibTokenAdapter.pendingRewards(bob) must be 100 * (4/5) = 80 ALPACA
        // - ibTokenAdapter.pendingRewards(deployer) must be 0 ALPACA as he doesn't do anything
        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("5"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("200")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("800"))

        expect(await ibTokenAdapter.pendingRewards(aliceAddress)).to.be.eq(ethers.utils.parseEther("220"))
        expect(await ibTokenAdapter.pendingRewards(bobAddress)).to.be.eq(ethers.utils.parseEther("80"))
        expect(await ibTokenAdapter.pendingRewards(deployerAddress)).to.be.eq(0)
      })
    })
  })

  describe("#cage", async () => {})
})
