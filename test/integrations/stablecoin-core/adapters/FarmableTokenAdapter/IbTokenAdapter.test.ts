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
  BEP20,
  Shield,
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
  await alpacaToken.mint(await deployer.getAddress(), ethers.utils.parseEther("150"))
  await alpacaToken.deployed()

  const FairLaunch = (await ethers.getContractFactory("FairLaunch", deployer)) as FairLaunch__factory
  const fairLaunch = await FairLaunch.deploy(
    alpacaToken.address,
    await deployer.getAddress(),
    ALPACA_PER_BLOCK,
    0,
    0,
    0
  )
  await fairLaunch.deployed()

  const Shield = (await ethers.getContractFactory("Shield", deployer)) as Shield__factory
  const shield = await Shield.deploy(deployer.address, fairLaunch.address)
  await shield.deployed()

  // Config Alpaca's FairLaunch
  // Assuming Deployer is timelock for easy testing
  await fairLaunch.addPool(1, ibDUMMY.address, true)
  await fairLaunch.transferOwnership(shield.address)
  await shield.transferOwnership(await deployer.getAddress())
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
    await deployer.getAddress(),
    BigNumber.from(1000),
    await dev.getAddress(),
  ])) as IbTokenAdapter
  await ibTokenAdapter.deployed()

  await bookKeeper.grantRole(ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]), ibTokenAdapter.address)

  return {
    ibTokenAdapter,
    bookKeeper,
    ibDUMMY,
    shield,
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
  let alpacaToken: AlpacaToken
  let fairLaunch: FairLaunch

  // Signer
  let ibTokenAdapterAsAlice: IbTokenAdapter
  let ibTokenAdapterAsBob: IbTokenAdapter

  let ibDUMMYasAlice: BEP20
  let ibDUMMYasBob: BEP20

  beforeEach(async () => {
    ;({ ibTokenAdapter, bookKeeper, ibDUMMY, shield, alpacaToken, fairLaunch } = await waffle.loadFixture(
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
            deployerAddress,
            BigNumber.from(1000),
            deployerAddress,
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
            deployerAddress,
            BigNumber.from(1000),
            deployerAddress,
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
            deployerAddress,
            BigNumber.from(1000),
            deployerAddress,
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
            shield.address,
            BigNumber.from(1000),
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
        expect(await ibTokenAdapter.timelock()).to.be.eq(deployerAddress)
        expect(await ibTokenAdapter.decimals()).to.be.eq(18)
      })
    })
  })

  describe("#netAssetValuation", async () => {
    context("when all collateral tokens are deposited by deposit function", async () => {
      it("should return the correct net asset valuation", async () => {
        await ibDUMMYasAlice.approve(ibTokenAdapter.address, ethers.utils.parseEther("1"))
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        expect(await ibTokenAdapter.netAssetValuation()).to.be.eq(ethers.utils.parseEther("1"))

        await ibTokenAdapterAsAlice.withdraw(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )
        expect(await ibTokenAdapter.netAssetValuation()).to.be.eq(0)
      })
    })

    context("when some one directly transfer collateral tokens to IbTokenAdapter", async () => {
      it("should only recognized collateral tokens from deposit function", async () => {
        await ibDUMMYasAlice.approve(ibTokenAdapter.address, ethers.utils.parseEther("1"))
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        await ibDUMMYasBob.transfer(ibTokenAdapter.address, ethers.utils.parseEther("88"))

        expect(await ibDUMMY.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("88"))
        expect(await ibTokenAdapter.netAssetValuation()).to.be.eq(ethers.utils.parseEther("1"))

        await ibTokenAdapterAsAlice.withdraw(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        expect(await ibDUMMY.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("88"))
        expect(await ibTokenAdapter.netAssetValuation()).to.be.eq(0)
      })
    })
  })

  describe("#netAssetPerShare", async () => {
    context("when all collateral tokens are deposited by deposit function", async () => {
      it("should return the correct net asset per share", async () => {
        await ibDUMMYasAlice.approve(ibTokenAdapter.address, ethers.utils.parseEther("1"))
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        // Expect netAssetPerShare = 1 as share = asset
        expect(await ibTokenAdapter.netAssetPerShare()).to.be.eq(ethers.utils.parseEther("1"))

        await ibTokenAdapterAsAlice.withdraw(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        // If total share = 0, the net asset per share = WAD
        expect(await ibTokenAdapter.netAssetPerShare()).to.be.eq(ethers.utils.parseEther("1"))
      })
    })

    context("when some one directly transfer collateral tokens to IbTokenAdapter", async () => {
      it("should only recognized collateral tokens from deposit function", async () => {
        await ibDUMMYasAlice.approve(ibTokenAdapter.address, ethers.utils.parseEther("1"))
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        await ibDUMMYasBob.transfer(ibTokenAdapter.address, ethers.utils.parseEther("88"))

        expect(await ibDUMMY.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("88"))
        expect(await ibTokenAdapter.netAssetPerShare()).to.be.eq(ethers.utils.parseEther("1"))

        await ibTokenAdapterAsAlice.withdraw(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )
        expect(await ibDUMMY.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("88"))
        // If total share = 0, the net asset per share = WAD
        expect(await ibTokenAdapter.netAssetPerShare()).to.be.eq(ethers.utils.parseEther("1"))
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
        ).to.be.revertedWith("IbTokenAdapter/not live")
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

        // Now Alice harvest rewards. 1 block has been passed, hence Alice should get 90 (100 - 10%) ALPACA, treasury account should get 10 ALPACA.
        await ibTokenAdapterAsAlice.deposit(
          aliceAddress,
          0,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("90"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("100")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("0"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(ethers.utils.parseEther("100"))
        expect(await alpacaToken.balanceOf(devAddress)).to.be.eq(ethers.utils.parseEther("10"))

        // Bob join the party! As 2 blocks moved. IbTokenAdapter earned 200 ALPACA
        await ibDUMMYasBob.approve(ibTokenAdapter.address, ethers.utils.parseEther("4"))
        await ibTokenAdapterAsBob.deposit(
          bobAddress,
          ethers.utils.parseEther("4"),
          ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress])
        )

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("90"))
        expect(await alpacaToken.balanceOf(bobAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("5"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("300")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(ethers.utils.parseEther("100"))
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("1200"))
        expect(await alpacaToken.balanceOf(devAddress)).to.be.eq(ethers.utils.parseEther("10"))

        // Bob harvest ALPACA. IbTokenAdapter earned another 100 ALPACA.
        // IbTokenAdapter has another 100 ALPACA from previous block. Hence,
        // balanceOf(address(this)) should return 300 ALPACA.
        // Bob should get 72 (80 - 10%) ALPACA, treasury account should get 8 ALPACA.
        await ibTokenAdapterAsBob.deposit(bobAddress, 0, ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress]))

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("220"))
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("90"))
        expect(await alpacaToken.balanceOf(bobAddress)).to.be.eq(ethers.utils.parseEther("72"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("5"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("320")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("220"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(ethers.utils.parseEther("100"))
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("1280"))
        expect(await alpacaToken.balanceOf(devAddress)).to.be.eq(ethers.utils.parseEther("18"))
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
        ).to.be.revertedWith("IbTokenAdapter/insufficient staked amount")
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
        // - Alice should get 180 (200 - 10%) ALPACA that is harvested before cage (when Bob deposited)
        // - Alice should get 1 ibDUMMY back.
        // - treasury account should get 20 ALPACA.
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
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("180"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("200")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("800"))
        expect(await alpacaToken.balanceOf(devAddress)).to.be.eq(ethers.utils.parseEther("20"))

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
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("180"))
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

        // Now Alice withdraw her position. 1 block has been passed, hence Alice should get 90 (100 - 10%) ALPACA, treasury account should get 10 ALPACA.
        let aliceIbDUMMYbefore = await ibDUMMY.balanceOf(aliceAddress)
        await ibTokenAdapterAsAlice.withdraw(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )
        let aliceIbDUMMYafter = await ibDUMMY.balanceOf(aliceAddress)

        expect(aliceIbDUMMYafter.sub(aliceIbDUMMYbefore)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("90"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("100")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(devAddress)).to.be.eq(ethers.utils.parseEther("10"))
      })
    })
  })

  describe("#emergencyWithdraw", async () => {
    context("when IbTokenAdapter is not live", async () => {
      it("should allow users to exit with emergencyWithdraw and normal withdraw", async () => {
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

        // IbTokenAdapter is caged. Staked collateralTokens have been emergencyWithdraw from FairLaunch.
        // Only 200 ALPACA has been harvested from FairLaunch.
        // The following conditions must be satisfy:
        // - Alice pending rewards must be 200 ALPACA
        // - Bob pending rewards must be 0 ALPACA as all rewards after Bob deposited hasn't been harvested.
        expect(await ibTokenAdapter.pendingRewards(aliceAddress)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.pendingRewards(bobAddress)).to.be.eq(0)

        // Alice panic and decided to emergencyWithdraw.
        // The following states are expected:
        // - ibTokenAdapte should still has 200 ALPACA as Alice dismiss her rewards
        // - Alice should not get any ALPACA as she decided to do exit via emergency withdraw instead of withdraw
        // - Alice should get 1 ibDUMMY back.
        let aliceIbDUMMYbefore = await ibDUMMY.balanceOf(aliceAddress)
        await ibTokenAdapterAsAlice.emergencyWithdraw(aliceAddress, aliceAddress)
        let aliceIbDUMMYafter = await ibDUMMY.balanceOf(aliceAddress)

        expect(aliceIbDUMMYafter.sub(aliceIbDUMMYbefore)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await fairLaunch.pendingAlpaca(0, ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("200")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("800"))

        // Bob is a cool guy. Not panic and withdraw normal.
        // The following states are expected:
        // - Bob should get his 4 ibDUMMY back
        // - Bob hasn't earn any ALPACA yet so he didn't get any ALPACA
        // - IbTokenAdapter should still has 200 ALPACA that Alice dismissed
        let bobIbDUMMYbefore = await ibDUMMY.balanceOf(bobAddress)
        await ibTokenAdapterAsBob.withdraw(
          bobAddress,
          ethers.utils.parseEther("4"),
          ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress])
        )
        let bobIbDUMMYafter = await ibDUMMY.balanceOf(bobAddress)

        expect(bobIbDUMMYafter.sub(bobIbDUMMYbefore)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await fairLaunch.pendingAlpaca(0, ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(bobAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("200")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(0)
      })
    })

    context("when all states are normal", async () => {
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

        // Alice feels in-secure, so she does emergencyWithdraw
        // The following conditions must be satisfied:
        // - Alice should get here 1 ibDUMMY back
        // - Alice shouldn't be paid by any ALPACA
        // - Alice's state should be reset
        let aliceIbDUMMYbefore = await ibDUMMY.balanceOf(aliceAddress)
        await ibTokenAdapterAsAlice.emergencyWithdraw(aliceAddress, aliceAddress)
        let aliceIbDUMMYafter = await ibDUMMY.balanceOf(aliceAddress)

        expect(aliceIbDUMMYafter.sub(aliceIbDUMMYbefore)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("100"))
        expect(await fairLaunch.pendingAlpaca(0, ibTokenAdapter.address)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(0)
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

    context("when IbTokenAdapter is not live", async () => {
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

  describe("#cage/#uncage", async () => {
    context("when whitelist cage", async () => {
      it("should put IbTokenAdapter live = 0", async () => {
        await ibTokenAdapter.cage()
        expect(await ibTokenAdapter.live()).to.be.eq(0)
      })
    })

    context("when caller not owner role cage", async () => {
      context("when assumptions still valid", async () => {
        it("should revert", async () => {
          await expect(ibTokenAdapterAsAlice.cage()).to.be.revertedWith("IbTokenAdapter/not-authorized")
        })
      })

      context("when shield's owner is changed", async () => {
        it("should put IbTokenAdapter live = 0", async () => {
          await shield.transferOwnership(aliceAddress)
          await ibTokenAdapterAsAlice.cage()
          expect(await ibTokenAdapter.live()).to.be.eq(0)
        })
      })
    })

    context("when uncage live IbTokenAdapter", async () => {
      it("should revert", async () => {
        await expect(ibTokenAdapter.uncage()).to.be.revertedWith("IbTokenAdapter/not-caged")
      })
    })

    context("when cage and uncage", async () => {
      it("should resume operations perfectly", async () => {
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
        // - Alice should get 180 (200 - 10%) ALPACA that is harvested before cage (when Bob deposited)
        // - Alice should get 1 ibDUMMY back.
        // - Treasury account should get 20 ALPACA.
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
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("180"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("200")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("800"))
        expect(await alpacaToken.balanceOf(devAddress)).to.be.eq(ethers.utils.parseEther("20"))

        await ibTokenAdapter.uncage()
        expect(await ibTokenAdapter.live()).to.be.eq(1)

        // Move 1 block from where IbTokenAdapter get uncaged.
        // Hence IbTokenAdapter should earned 100 ALPACA.
        // The following conditions must be satisfy:
        // - IbTokenAdapter must has 100 pending ALPACA
        // - Alice pending rewards must be 100 ALPACA
        // - Bob pending rewards must be 0 ALPACA
        await advanceBlock()
        expect(await fairLaunch.pendingAlpaca(0, ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("100"))
        expect(await ibTokenAdapter.pendingRewards(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.pendingRewards(bobAddress)).to.be.eq(ethers.utils.parseEther("100"))

        // Now Bob withdraw his position. Only 100 ALPACA has been harvested from FairLaunch.
        // Another 100 ALPACA is pending for IbTokenAdapter to harvest.
        // The following conditions must be satisfy:
        // - Bob should get 180 (200 - 10%) ALPACA as 2 blocks passed.
        // - Bob pending rewards must be 0 ALPACA as all rewards are harvested.
        // - Bob should get 4 ibDUMMY back.
        // - Alice's ALPACA should remain the same.
        // - Treasury account should get 20 ALPACA.
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
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("180"))
        expect(await alpacaToken.balanceOf(bobAddress)).to.be.eq(ethers.utils.parseEther("180"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("250")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(devAddress)).to.be.eq(ethers.utils.parseEther("40"))
      })
    })
  })

  describe("#complex", async () => {
    context("when someone sends reward token to IbTokenAdapter", async () => {
      it("should take them as rewards earned", async () => {
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

        // Assuming some bad luck dude transfer 150 ALPACA to IbTokenAdapter.
        // 1 Block get mined so IbTokenAdapter earned 100 ALPACA.
        // The following states are expected:
        // - Alice should has 250 pending ALPACA from ibTokenAdapter
        // - ibTokenAdapter should has 150 ALPACA from random dude
        // - ibTokenAdapter should has 100 pending ALPACA from FairLaunch
        // - accRewardPerShare, accRewardBalance, and rewardDebts must be remain the same
        await alpacaToken.transfer(ibTokenAdapter.address, ethers.utils.parseEther("150"))

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("150"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.pendingRewards(aliceAddress)).to.be.eq(ethers.utils.parseEther("250"))
        expect(await fairLaunch.pendingAlpaca(0, ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("100"))

        // Now Alice wants to harvest the yields. 1 Block move, IbTokenAdapter earned another 100 ALPACA.
        // The following states are expected:
        // - Alice should get 315 (350 - 10%) ALPACA in her account
        // - Alice pending ALPACA from ibTokenAdapter must be 0
        // - ibTokenAdapter should has 0 ALPACA as all harvested by Alice
        // - ibTokenAdapter should has 0 pending ALPACA as all harvested
        // - accRewardPershare, accRewardBalance, and rewardDebts must be updated correctly
        // - Treasury account should get 35 ALPACA.
        await ibTokenAdapterAsAlice.withdraw(
          aliceAddress,
          0,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("315"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("350")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(0)
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(ethers.utils.parseEther("350"))
        expect(await ibTokenAdapter.pendingRewards(aliceAddress)).to.be.eq(0)
        expect(await fairLaunch.pendingAlpaca(0, ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(devAddress)).to.be.eq(ethers.utils.parseEther("35"))
      })
    })

    context("when Alice exit with emergency withdraw, but Bob wait for uncage and withdraw", async () => {
      it("should only give Bob his rewards", async () => {
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

        // IbTokenAdapter is caged. Staked collateralTokens have been emergencyWithdraw from FairLaunch.
        // Only 200 ALPACA has been harvested from FairLaunch.
        // The following conditions must be satisfy:
        // - Alice pending rewards must be 200 ALPACA
        // - Bob pending rewards must be 0 ALPACA as all rewards after Bob deposited hasn't been harvested.
        expect(await ibTokenAdapter.pendingRewards(aliceAddress)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.pendingRewards(bobAddress)).to.be.eq(0)

        // Alice panic and decided to emergencyWithdraw.
        // The following states are expected:
        // - ibTokenAdapte should still has 200 ALPACA as Alice dismiss her rewards
        // - Alice should not get any ALPACA as she decided to do exit via emergency withdraw instead of withdraw
        // - Alice should get 1 ibDUMMY back.
        let aliceIbDUMMYbefore = await ibDUMMY.balanceOf(aliceAddress)
        await ibTokenAdapterAsAlice.emergencyWithdraw(aliceAddress, aliceAddress)
        let aliceIbDUMMYafter = await ibDUMMY.balanceOf(aliceAddress)

        expect(aliceIbDUMMYafter.sub(aliceIbDUMMYbefore)).to.be.eq(ethers.utils.parseEther("1"))
        expect(await fairLaunch.pendingAlpaca(0, ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("200")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("800"))

        // Everything is fine now. So IbTokenAdapter get uncage.
        // 1 Block is mined. However, IbTokenAdapter just deposit collateralTokens back
        // to FairLaunch at this block, hence it won't earn any ALPACA.
        // The following states are expected:
        // - IbTokenAdapter's live must be 1
        // - Bob pending ALPACA must be 0
        await ibTokenAdapter.uncage()
        expect(await ibTokenAdapter.live()).to.be.eq(1)
        expect(await ibTokenAdapter.pendingRewards(bobAddress)).to.be.eq(0)

        // Bob is a cool guy. Not panic, wait until everything becomes normal,
        // he will get his portion
        // The following states are expected:
        // - Bob should get his 4 ibDUMMY back
        // - Bob earn 90 (100 - 10%) ALPACA as block diff that Bob exit and uncage = 1 block
        // - IbTokenAdapter should still has 200 ALPACA that Alice dismissed
        // - Treasury account should get 10 ALPACA.
        let bobIbDUMMYbefore = await ibDUMMY.balanceOf(bobAddress)
        await ibTokenAdapterAsBob.withdraw(
          bobAddress,
          ethers.utils.parseEther("4"),
          ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress])
        )
        let bobIbDUMMYafter = await ibDUMMY.balanceOf(bobAddress)

        expect(bobIbDUMMYafter.sub(bobIbDUMMYbefore)).to.be.eq(ethers.utils.parseEther("4"))
        expect(await fairLaunch.pendingAlpaca(0, ibTokenAdapter.address)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("200"))
        expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(bobAddress)).to.be.eq(ethers.utils.parseEther("90"))
        expect(await ibTokenAdapter.totalShare()).to.be.eq(0)
        expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("225")))
        expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("200"))
        expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(0)
        expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(0)
        expect(await alpacaToken.balanceOf(devAddress)).to.be.eq(ethers.utils.parseEther("10"))
      })
    })
  })
})
