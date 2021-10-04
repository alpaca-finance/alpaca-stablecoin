import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import * as TimeHelpers from "../../helper/time"
import { MaxUint256 } from "@ethersproject/constants"

import {
  BookKeeper__factory,
  BookKeeper,
  BEP20__factory,
  BEP20,
  StablecoinAdapter__factory,
  StablecoinAdapter,
  AlpacaStablecoin__factory,
  AlpacaStablecoin,
  FlashMintModule__factory,
  FlashMintModule,
  StableSwapModule__factory,
  StableSwapModule,
  AuthTokenAdapter__factory,
  AuthTokenAdapter,
  SystemDebtEngine__factory,
  SystemDebtEngine,
} from "../../../typechain"
import { expect } from "chai"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"

import * as AssertHelpers from "../../helper/assert"

const { formatBytes32String } = ethers.utils
const COLLATERAL_POOL_ID = formatBytes32String("BUSD-StableSwap")
const FOREVER = "2000000000"

type fixture = {
  stablecoinAdapter: StablecoinAdapter
  bookKeeper: BookKeeper
  BUSD: BEP20
  alpacaStablecoin: AlpacaStablecoin
  flashMintModule: FlashMintModule
  stableSwapModule: StableSwapModule
  authTokenAdapter: AuthTokenAdapter
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer, alice, bob, dev] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const BookKeeper = (await ethers.getContractFactory("BookKeeper", deployer)) as BookKeeper__factory
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [])) as BookKeeper
  await bookKeeper.deployed()

  await bookKeeper.init(COLLATERAL_POOL_ID)
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(100000000000000))
  await bookKeeper.setDebtCeiling(COLLATERAL_POOL_ID, WeiPerRad.mul(100000000000000))
  await bookKeeper.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployer.address)
  await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const BUSD = await BEP20.deploy("BUSD", "BUSD")
  await BUSD.deployed()

  const AuthTokenAdapter = (await ethers.getContractFactory("AuthTokenAdapter", deployer)) as AuthTokenAdapter__factory
  const authTokenAdapter = (await upgrades.deployProxy(AuthTokenAdapter, [
    bookKeeper.address,
    COLLATERAL_POOL_ID,
    BUSD.address,
  ])) as AuthTokenAdapter
  await authTokenAdapter.deployed()
  await bookKeeper.grantRole(ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]), authTokenAdapter.address)
  await bookKeeper.grantRole(await bookKeeper.MINTABLE_ROLE(), deployer.address)

  // Deploy Alpaca Stablecoin
  const AlpacaStablecoin = (await ethers.getContractFactory("AlpacaStablecoin", deployer)) as AlpacaStablecoin__factory
  const alpacaStablecoin = await AlpacaStablecoin.deploy("Alpaca USD", "AUSD", "31337")
  await alpacaStablecoin.deployed()

  const StablecoinAdapter = (await ethers.getContractFactory(
    "StablecoinAdapter",
    deployer
  )) as StablecoinAdapter__factory
  const stablecoinAdapter = (await upgrades.deployProxy(StablecoinAdapter, [
    bookKeeper.address,
    alpacaStablecoin.address,
  ])) as StablecoinAdapter
  await stablecoinAdapter.deployed()
  await alpacaStablecoin.grantRole(await alpacaStablecoin.MINTER_ROLE(), stablecoinAdapter.address)
  await bookKeeper.whitelist(stablecoinAdapter.address)

  const SystemDebtEngine = (await ethers.getContractFactory("SystemDebtEngine", deployer)) as SystemDebtEngine__factory
  const systemDebtEngine = (await upgrades.deployProxy(SystemDebtEngine, [bookKeeper.address])) as SystemDebtEngine

  const StableSwapModule = (await ethers.getContractFactory("StableSwapModule", deployer)) as StableSwapModule__factory
  const stableSwapModule = (await upgrades.deployProxy(StableSwapModule, [
    authTokenAdapter.address,
    stablecoinAdapter.address,
    systemDebtEngine.address,
  ])) as StableSwapModule
  await stableSwapModule.deployed()
  await authTokenAdapter.grantRole(await authTokenAdapter.WHITELISTED(), stableSwapModule.address)
  await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), stableSwapModule.address)

  const FlashMintModule = (await ethers.getContractFactory("FlashMintModule", deployer)) as FlashMintModule__factory
  const flashMintModule = (await upgrades.deployProxy(FlashMintModule, [
    stablecoinAdapter.address,
    systemDebtEngine.address,
  ])) as FlashMintModule
  await flashMintModule.deployed()
  await flashMintModule.setMax(ethers.utils.parseEther("100000000"))
  await flashMintModule.setFeeRate(ethers.utils.parseEther("25").div(10000))
  await bookKeeper.grantRole(await bookKeeper.MINTABLE_ROLE(), flashMintModule.address)

  return {
    stablecoinAdapter,
    bookKeeper,
    BUSD,
    alpacaStablecoin,
    flashMintModule,
    stableSwapModule,
    authTokenAdapter,
  }
}

describe("FlastMintModule", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer
  let bob: Signer
  let dev: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string
  let bobAddress: string

  // Contracts
  let stablecoinAdapter: StablecoinAdapter
  let bookKeeper: BookKeeper
  let BUSD: BEP20
  let flashMintModule: FlashMintModule
  let stableSwapModule: StableSwapModule
  let authTokenAdapter: AuthTokenAdapter
  let alpacaStablecoin: AlpacaStablecoin
  let systemDebtEngine: SystemDebtEngine

  // Signer

  let busdAsAlice: BEP20
  let busdAsBob: BEP20

  let bookKeeperAsBob: BookKeeper

  beforeEach(async () => {
    ;({ stablecoinAdapter, bookKeeper, BUSD, alpacaStablecoin, flashMintModule, stableSwapModule, authTokenAdapter } =
      await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
    ])

    busdAsAlice = BEP20__factory.connect(BUSD.address, alice)
    busdAsBob = BEP20__factory.connect(BUSD.address, bob)

    bookKeeperAsBob = BookKeeper__factory.connect(bookKeeper.address, bob)
  })
  describe("#flashLoan", async () => {
    context("AUSD price at $1", async () => {
      it("should revert, because there is no arbitrage opportunity, thus no profit to pay for flash mint fee", async () => {
        // Deployer adds 1000 BUSD + 1000 AUSD
        await BUSD.mint(deployerAddress, ethers.utils.parseEther("1000"))
        await bookKeeper.mintUnbackedStablecoin(
          deployerAddress,
          deployerAddress,
          ethers.utils.parseEther("1000").mul(WeiPerRay)
        )
        await stablecoinAdapter.withdraw(deployerAddress, ethers.utils.parseEther("1000"), "0x")
        await BUSD.approve(routerV2.address, ethers.utils.parseEther("1000"))
        await alpacaStablecoin.approve(routerV2.address, ethers.utils.parseEther("1000"))
        await routerV2.addLiquidity(
          BUSD.address,
          alpacaStablecoin.address,
          ethers.utils.parseEther("1000"),
          ethers.utils.parseEther("1000"),
          "0",
          "0",
          await deployerAddress,
          FOREVER
        )

        // Current AUSD price is $1
        // Perform flash mint to arbitrage
        await expect(
          flashMintModule.flashLoan(
            flashMintArbitrager.address,
            alpacaStablecoin.address,
            ethers.utils.parseEther("10"),
            ethers.utils.defaultAbiCoder.encode(
              ["address", "address", "address"],
              [routerV2.address, BUSD.address, stableSwapModule.address]
            )
          )
        ).to.be.revertedWith("AlpacaStablecoin/insufficient-balance")
      })
    })

    context("AUSD price at $1.5", async () => {
      it("should success", async () => {
        // Deployer adds 1500 BUSD + 1000 AUSD
        await BUSD.mint(deployerAddress, ethers.utils.parseEther("1500"))
        await bookKeeper.mintUnbackedStablecoin(
          deployerAddress,
          deployerAddress,
          ethers.utils.parseEther("1000").mul(WeiPerRay)
        )
        await stablecoinAdapter.withdraw(deployerAddress, ethers.utils.parseEther("1000"), "0x")
        await BUSD.approve(routerV2.address, ethers.utils.parseEther("1500"))
        await alpacaStablecoin.approve(routerV2.address, ethers.utils.parseEther("1000"))
        await routerV2.addLiquidity(
          BUSD.address,
          alpacaStablecoin.address,
          ethers.utils.parseEther("1500"),
          ethers.utils.parseEther("1000"),
          "0",
          "0",
          await deployerAddress,
          FOREVER
        )

        // Current AUSD price is $1.5
        // Perform flash mint to arbitrage
        await flashMintModule.flashLoan(
          flashMintArbitrager.address,
          alpacaStablecoin.address,
          ethers.utils.parseEther("50"),
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "address"],
            [routerV2.address, BUSD.address, stableSwapModule.address]
          )
        )

        const profitFromArbitrage = await alpacaStablecoin.balanceOf(flashMintArbitrager.address)
        expect(profitFromArbitrage).to.be.gt(0)

        const feeCollectedFromFlashMint = await bookKeeper.stablecoin(flashMintModule.address)
        expect(feeCollectedFromFlashMint).to.be.equal(ethers.utils.parseEther("0.125").mul(WeiPerRay))
      })
    })
  })

  describe("#bookKeeperFlashLoan", async () => {
    context("AUSD price at $1", async () => {
      it("should revert, because there is no arbitrage opportunity, thus no profit to pay for flash mint fee", async () => {
        // Deployer adds 1000 BUSD + 1000 AUSD
        await BUSD.mint(deployerAddress, ethers.utils.parseEther("1000"))
        await bookKeeper.mintUnbackedStablecoin(
          deployerAddress,
          deployerAddress,
          ethers.utils.parseEther("1000").mul(WeiPerRay)
        )
        await stablecoinAdapter.withdraw(deployerAddress, ethers.utils.parseEther("1000"), "0x")
        await BUSD.approve(routerV2.address, ethers.utils.parseEther("1000"))
        await alpacaStablecoin.approve(routerV2.address, ethers.utils.parseEther("1000"))
        await routerV2.addLiquidity(
          BUSD.address,
          alpacaStablecoin.address,
          ethers.utils.parseEther("1000"),
          ethers.utils.parseEther("1000"),
          "0",
          "0",
          await deployerAddress,
          FOREVER
        )

        // Current AUSD price is $1
        // Perform flash mint to arbitrage
        await expect(
          flashMintModule.bookKeeperFlashLoan(
            bookKeeperFlashMintArbitrager.address,
            ethers.utils.parseEther("10"),
            ethers.utils.defaultAbiCoder.encode(
              ["address", "address", "address"],
              [routerV2.address, BUSD.address, stableSwapModule.address]
            )
          )
        ).to.be.reverted
      })
    })

    context("AUSD price at $1.5", async () => {
      it("should success", async () => {
        // Deployer adds 1500 BUSD + 1000 AUSD
        await BUSD.mint(deployerAddress, ethers.utils.parseEther("1500"))
        await bookKeeper.mintUnbackedStablecoin(
          deployerAddress,
          deployerAddress,
          ethers.utils.parseEther("1000").mul(WeiPerRay)
        )
        await stablecoinAdapter.withdraw(deployerAddress, ethers.utils.parseEther("1000"), "0x")
        await BUSD.approve(routerV2.address, ethers.utils.parseEther("1500"))
        await alpacaStablecoin.approve(routerV2.address, ethers.utils.parseEther("1000"))
        await routerV2.addLiquidity(
          BUSD.address,
          alpacaStablecoin.address,
          ethers.utils.parseEther("1500"),
          ethers.utils.parseEther("1000"),
          "0",
          "0",
          await deployerAddress,
          FOREVER
        )

        // Current AUSD price is $1.5
        // Perform flash mint to arbitrage
        await flashMintModule.bookKeeperFlashLoan(
          bookKeeperFlashMintArbitrager.address,
          ethers.utils.parseEther("50").mul(WeiPerRay),
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "address"],
            [routerV2.address, BUSD.address, stableSwapModule.address]
          )
        )

        const profitFromArbitrage = await alpacaStablecoin.balanceOf(bookKeeperFlashMintArbitrager.address)
        expect(profitFromArbitrage).to.be.gt(0)

        const feeCollectedFromFlashMint = await bookKeeper.stablecoin(flashMintModule.address)
        expect(feeCollectedFromFlashMint).to.be.equal(ethers.utils.parseEther("0.125").mul(WeiPerRay))
      })
    })
  })
})
