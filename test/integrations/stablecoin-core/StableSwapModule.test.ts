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
  CollateralPoolConfig__factory,
  CollateralPoolConfig,
  SimplePriceFeed__factory,
  SimplePriceFeed,
  AccessControlConfig__factory,
  AccessControlConfig,
} from "../../../typechain"
import { expect } from "chai"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"

import * as AssertHelpers from "../../helper/assert"
import { AddressZero } from "../../helper/address"

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
  systemDebtEngine: SystemDebtEngine
  collateralPoolConfig: CollateralPoolConfig
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer, alice, bob, dev] = await ethers.getSigners()

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

  // Deploy mocked BookKeeper
  const BookKeeper = (await ethers.getContractFactory("BookKeeper", deployer)) as BookKeeper__factory
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [
    collateralPoolConfig.address,
    accessControlConfig.address,
  ])) as BookKeeper
  await bookKeeper.deployed()

  await accessControlConfig.grantRole(await accessControlConfig.BOOK_KEEPER_ROLE(), bookKeeper.address)

  const SimplePriceFeed = (await ethers.getContractFactory("SimplePriceFeed", deployer)) as SimplePriceFeed__factory
  const simplePriceFeed = (await upgrades.deployProxy(SimplePriceFeed, [
    accessControlConfig.address,
  ])) as SimplePriceFeed
  await simplePriceFeed.deployed()

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
  await accessControlConfig.grantRole(
    ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]),
    authTokenAdapter.address
  )
  await accessControlConfig.grantRole(await accessControlConfig.MINTABLE_ROLE(), deployer.address)

  await collateralPoolConfig.initCollateralPool(
    COLLATERAL_POOL_ID,
    WeiPerRad.mul(100000000000000),
    0,
    simplePriceFeed.address,
    0,
    WeiPerRay,
    authTokenAdapter.address,
    0,
    0,
    0,
    AddressZero
  )
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(100000000000000))
  await accessControlConfig.grantRole(await accessControlConfig.PRICE_ORACLE_ROLE(), deployer.address)
  await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

  // Deploy Alpaca Stablecoin
  const AlpacaStablecoin = (await ethers.getContractFactory("AlpacaStablecoin", deployer)) as AlpacaStablecoin__factory
  const alpacaStablecoin = (await upgrades.deployProxy(AlpacaStablecoin, [
    "Alpaca USD",
    "AUSD",
    "31337",
  ])) as AlpacaStablecoin
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
  await stableSwapModule.setFeeIn(ethers.utils.parseEther("0.001"))
  await stableSwapModule.setFeeOut(ethers.utils.parseEther("0.001"))
  await authTokenAdapter.grantRole(await authTokenAdapter.WHITELISTED(), stableSwapModule.address)
  await accessControlConfig.grantRole(await accessControlConfig.POSITION_MANAGER_ROLE(), stableSwapModule.address)

  const FlashMintModule = (await ethers.getContractFactory("FlashMintModule", deployer)) as FlashMintModule__factory
  const flashMintModule = (await upgrades.deployProxy(FlashMintModule, [
    stablecoinAdapter.address,
    systemDebtEngine.address,
  ])) as FlashMintModule
  await flashMintModule.deployed()
  await flashMintModule.setMax(ethers.utils.parseEther("100000000"))
  await flashMintModule.setFeeRate(ethers.utils.parseEther("25").div(10000))
  await accessControlConfig.grantRole(await accessControlConfig.MINTABLE_ROLE(), flashMintModule.address)

  return {
    stablecoinAdapter,
    bookKeeper,
    BUSD,
    alpacaStablecoin,
    flashMintModule,
    stableSwapModule,
    authTokenAdapter,
    systemDebtEngine,
    collateralPoolConfig,
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
  let collateralPoolConfig: CollateralPoolConfig

  // Signer

  let busdAsAlice: BEP20
  let busdAsBob: BEP20

  let bookKeeperAsBob: BookKeeper

  beforeEach(async () => {
    ;({
      stablecoinAdapter,
      bookKeeper,
      BUSD,
      alpacaStablecoin,
      flashMintModule,
      stableSwapModule,
      authTokenAdapter,
      systemDebtEngine,
      collateralPoolConfig,
    } = await waffle.loadFixture(loadFixtureHandler))
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
  describe("#swapTokenToStablecoin", async () => {
    context("exceed debtCeiling", async () => {
      it("should revert", async () => {
        // Set debtCeiling of StableSwapModule to 0
        await collateralPoolConfig.setDebtCeiling(COLLATERAL_POOL_ID, 0)

        // Mint 1000 BUSD to deployer
        await BUSD.mint(deployerAddress, ethers.utils.parseEther("1000"))

        // Swap 1000 BUSD to AUSD
        await BUSD.approve(authTokenAdapter.address, MaxUint256)
        await expect(
          stableSwapModule.swapTokenToStablecoin(deployerAddress, ethers.utils.parseEther("1000"))
        ).to.be.revertedWith("BookKeeper/ceiling-exceeded")
      })
    })

    context("swap BUSD when BUSD is insufficient", async () => {
      it("should revert", async () => {
        // Mint 1000 BUSD to deployer
        await BUSD.mint(deployerAddress, ethers.utils.parseEther("1000"))

        // Swap 1000 BUSD to AUSD
        await BUSD.approve(authTokenAdapter.address, MaxUint256)
        await expect(
          stableSwapModule.swapTokenToStablecoin(deployerAddress, ethers.utils.parseEther("1001"))
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance")
      })
    })
    context("swap BUSD to AUSD", async () => {
      it("should success", async () => {
        // Mint 1000 BUSD to deployer
        await BUSD.mint(deployerAddress, ethers.utils.parseEther("1000"))

        // Swap 1000 BUSD to AUSD
        await BUSD.approve(authTokenAdapter.address, MaxUint256)
        await stableSwapModule.swapTokenToStablecoin(deployerAddress, ethers.utils.parseEther("1000"))

        // 1000 * 0.001 = 1
        const feeFromSwap = await bookKeeper.stablecoin(systemDebtEngine.address)
        expect(feeFromSwap).to.be.equal(ethers.utils.parseEther("1").mul(WeiPerRay))

        // stablecoinReceived = swapAmount - fee = 1000 - 1 = 999
        const stablecoinReceived = await alpacaStablecoin.balanceOf(deployerAddress)
        expect(stablecoinReceived).to.be.equal(ethers.utils.parseEther("999"))

        const busdCollateralAmount = (await bookKeeper.positions(COLLATERAL_POOL_ID, stableSwapModule.address))
          .lockedCollateral
        expect(busdCollateralAmount).to.be.equal(ethers.utils.parseEther("1000"))
      })
    })
  })

  describe("#swapStablecoinToToken", async () => {
    context("collateral not enough", async () => {
      it("should revert", async () => {
        // Mint 1000 AUSD to deployer
        await bookKeeper.mintUnbackedStablecoin(
          deployerAddress,
          deployerAddress,
          ethers.utils.parseEther("1001").mul(WeiPerRay)
        )
        await stablecoinAdapter.withdraw(deployerAddress, ethers.utils.parseEther("1001"), "0x")

        // Swap 1000 AUSD to BUSD
        await alpacaStablecoin.approve(stableSwapModule.address, MaxUint256)
        await expect(stableSwapModule.swapStablecoinToToken(deployerAddress, ethers.utils.parseEther("1000"))).to.be
          .reverted
      })
    })

    context("swap AUSD to BUSD", async () => {
      it("should success", async () => {
        // Mint 1000 BUSD to deployer
        await BUSD.mint(deployerAddress, ethers.utils.parseEther("1000"))

        // Swap 1000 BUSD to AUSD
        await BUSD.approve(authTokenAdapter.address, MaxUint256)
        await stableSwapModule.swapTokenToStablecoin(deployerAddress, ethers.utils.parseEther("1000"))

        // Swap 998 AUSD to BUSD
        await alpacaStablecoin.approve(stableSwapModule.address, MaxUint256)
        await stableSwapModule.swapStablecoinToToken(deployerAddress, ethers.utils.parseEther("998"))

        // first swap = 1000 * 0.001 = 1 AUSD
        // second swap = 998 * 0.001 = 0.998 AUSD
        // total fee = 1 + 0.998 = 1.998
        const feeFromSwap = await bookKeeper.stablecoin(systemDebtEngine.address)
        expect(feeFromSwap).to.be.equal(ethers.utils.parseEther("1.998").mul(WeiPerRay))

        const busdReceived = await BUSD.balanceOf(deployerAddress)
        expect(busdReceived).to.be.equal(ethers.utils.parseEther("998"))

        const busdCollateralAmount = (await bookKeeper.positions(COLLATERAL_POOL_ID, stableSwapModule.address))
          .lockedCollateral
        expect(busdCollateralAmount).to.be.equal(ethers.utils.parseEther("2"))
      })
    })
  })
})
