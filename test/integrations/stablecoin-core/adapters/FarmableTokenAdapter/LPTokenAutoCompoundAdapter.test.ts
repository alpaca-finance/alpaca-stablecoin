import { ethers, upgrades, waffle, network } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import * as TimeHelpers from "../../../../helper/time"
import { MaxUint256 } from "@ethersproject/constants"

import {
  ProxyWalletRegistry__factory,
  ProxyWalletFactory__factory,
  ProxyWalletRegistry,
  BookKeeper__factory,
  PositionManager,
  PositionManager__factory,
  BookKeeper,
  AlpacaStablecoinProxyActions__factory,
  AlpacaStablecoinProxyActions,
  StablecoinAdapter__factory,
  StablecoinAdapter,
  AlpacaStablecoin__factory,
  AlpacaStablecoin,
  ProxyWallet,
  SystemDebtEngine__factory,
  SystemDebtEngine,
  CollateralPoolConfig__factory,
  CollateralPoolConfig,
  SimplePriceFeed__factory,
  SimplePriceFeed,
  AccessControlConfig__factory,
  AccessControlConfig,
  ShowStopper,
  ShowStopper__factory,
  LPTokenAutoCompoundAdapter__factory,
  LPTokenAutoCompoundAdapter,
  BEP20__factory,
  BEP20,
  PancakeswapV2RestrictedStrategyAddBaseTokenOnly__factory,
  PancakeswapV2RestrictedStrategyAddBaseTokenOnly,
  PancakeMasterChef__factory,
  PancakeMasterChef,
} from "../../../../../typechain"
import {
  PancakeFactory__factory,
  PancakeFactory,
  PancakePair__factory,
  PancakePair,
  WETH__factory,
  WETH,
  CakeToken__factory,
  CakeToken,
  SyrupBar__factory,
  PancakeRouterV2__factory,
  PancakeRouterV2,
} from "@alpaca-finance/alpaca-contract/typechain"
import { expect } from "chai"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../../../helper/unit"
import { loadProxyWalletFixtureHandler } from "../../../../helper/proxy"

import * as AssertHelpers from "../../../../helper/assert"
import { AddressZero } from "../../../../helper/address"

const { formatBytes32String } = ethers.utils
const FOREVER = "2000000000"

type fixture = {
  proxyWalletRegistry: ProxyWalletRegistry
  stablecoinAdapter: StablecoinAdapter
  bookKeeper: BookKeeper
  alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  positionManager: PositionManager
  alpacaStablecoin: AlpacaStablecoin
  simplePriceFeed: SimplePriceFeed
  systemDebtEngine: SystemDebtEngine
  collateralPoolConfig: CollateralPoolConfig
  cake: CakeToken
  masterChef: PancakeMasterChef
  router: PancakeRouterV2
  addStrat: PancakeswapV2RestrictedStrategyAddBaseTokenOnly
  lpToken: PancakePair
  lpTokenAutoCompoundAdapter: LPTokenAutoCompoundAdapter
  busd: BEP20
  wbnb: WETH
  factoryV2: PancakeFactory
}

const COLLATERAL_POOL_ID = formatBytes32String("BUSD-AUSD PCS")
const CLOSE_FACTOR_BPS = BigNumber.from(5000)
const LIQUIDATOR_INCENTIVE_BPS = BigNumber.from(10250)
const TREASURY_FEE_BPS = BigNumber.from(5000)
const BPS = BigNumber.from(10000)
const CAKE_REWARD_PER_BLOCK = ethers.utils.parseEther("0.1")

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer, alice, bob, dev] = await ethers.getSigners()

  const ProxyWalletFactory = new ProxyWalletFactory__factory(deployer)
  const proxyWalletFactory = await ProxyWalletFactory.deploy()

  const ProxyWalletRegistry = new ProxyWalletRegistry__factory(deployer)
  const proxyWalletRegistry = (await upgrades.deployProxy(ProxyWalletRegistry, [
    proxyWalletFactory.address,
  ])) as ProxyWalletRegistry

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
  await accessControlConfig.grantRole(await accessControlConfig.MINTABLE_ROLE(), deployer.address)

  // Deploy ShowStopper
  const ShowStopper = (await ethers.getContractFactory("ShowStopper", deployer)) as ShowStopper__factory
  const showStopper = (await upgrades.deployProxy(ShowStopper, [bookKeeper.address])) as ShowStopper

  // Deploy PositionManager
  const PositionManager = (await ethers.getContractFactory("PositionManager", deployer)) as PositionManager__factory
  const positionManager = (await upgrades.deployProxy(PositionManager, [
    bookKeeper.address,
    showStopper.address,
  ])) as PositionManager
  await positionManager.deployed()
  await accessControlConfig.grantRole(await accessControlConfig.POSITION_MANAGER_ROLE(), positionManager.address)

  const SimplePriceFeed = (await ethers.getContractFactory("SimplePriceFeed", deployer)) as SimplePriceFeed__factory
  const simplePriceFeed = (await upgrades.deployProxy(SimplePriceFeed, [
    accessControlConfig.address,
  ])) as SimplePriceFeed
  await simplePriceFeed.deployed()

  // Setup Pancakeswap
  const PancakeFactoryV2 = new PancakeFactory__factory(deployer)
  const factoryV2 = (await PancakeFactoryV2.deploy(await deployer.getAddress())) as PancakeFactory
  await factoryV2.deployed()

  const WBNB = new WETH__factory(deployer)
  const wbnb = await WBNB.deploy()
  await wbnb.deployed()

  const PancakeRouterV2 = new PancakeRouterV2__factory(deployer)
  const router = await PancakeRouterV2.deploy(factoryV2.address, wbnb.address)
  await router.deployed()

  // Deploy Alpaca Stablecoin
  const AlpacaStablecoin = (await ethers.getContractFactory("AlpacaStablecoin", deployer)) as AlpacaStablecoin__factory
  const alpacaStablecoin = (await upgrades.deployProxy(AlpacaStablecoin, ["Alpaca USD", "AUSD"])) as AlpacaStablecoin
  await alpacaStablecoin.deployed()

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("contracts/6.12/mocks/BEP20.sol:BEP20", deployer)) as BEP20__factory
  const BUSD = (await BEP20.deploy("BUSD", "BUSD")) as BEP20
  await BUSD.deployed()
  await BUSD.mint(alice.address, ethers.utils.parseEther("100"))

  const TUSD = await BEP20.deploy("TUSD", "TUSD")
  await TUSD.deployed()
  await TUSD.mint(alice.address, ethers.utils.parseEther("100"))

  /// Setup BUSD-AUSD pair on Pancakeswap
  await factoryV2.createPair(BUSD.address, alpacaStablecoin.address)
  const lpToken = PancakePair__factory.connect(
    await factoryV2.getPair(BUSD.address, alpacaStablecoin.address),
    deployer
  )
  await lpToken.deployed()

  const CakeToken = new CakeToken__factory(deployer)
  const cake = await CakeToken.deploy()
  const SyrupBar = new SyrupBar__factory(deployer)
  const syrup = await SyrupBar.deploy(cake.address)

  /// Setup MasterChef
  const PancakeMasterChef = new PancakeMasterChef__factory(deployer)
  const masterChef = await PancakeMasterChef.deploy(
    cake.address,
    syrup.address,
    await deployer.getAddress(),
    CAKE_REWARD_PER_BLOCK,
    0
  )
  await masterChef.add(1, lpToken.address, true)

  const PancakeswapV2RestrictedStrategyAddBaseTokenOnly = (await ethers.getContractFactory(
    "PancakeswapV2RestrictedStrategyAddBaseTokenOnly",
    deployer
  )) as PancakeswapV2RestrictedStrategyAddBaseTokenOnly__factory
  const addStrat = (await upgrades.deployProxy(PancakeswapV2RestrictedStrategyAddBaseTokenOnly, [
    router.address,
  ])) as PancakeswapV2RestrictedStrategyAddBaseTokenOnly
  await addStrat.deployed()

  const LPTokenAutoCompoundAdapter = (await ethers.getContractFactory(
    "LPTokenAutoCompoundAdapter",
    deployer
  )) as LPTokenAutoCompoundAdapter__factory
  const lpTokenAutoCompoundAdapter = (await upgrades.deployProxy(LPTokenAutoCompoundAdapter, [
    bookKeeper.address,
    COLLATERAL_POOL_ID,
    lpToken.address,
    cake.address,
    masterChef.address,
    1,
    TREASURY_FEE_BPS,
    deployer.address,
    positionManager.address,
    router.address,
    BUSD.address,
    addStrat.address,
  ])) as LPTokenAutoCompoundAdapter
  await lpTokenAutoCompoundAdapter.deployed()
  await addStrat.setWorkersOk([lpTokenAutoCompoundAdapter.address], true)
  await accessControlConfig.grantRole(await accessControlConfig.ADAPTER_ROLE(), lpTokenAutoCompoundAdapter.address)

  await collateralPoolConfig.initCollateralPool(
    COLLATERAL_POOL_ID,
    0,
    0,
    simplePriceFeed.address,
    WeiPerRay,
    WeiPerRay,
    lpTokenAutoCompoundAdapter.address,
    CLOSE_FACTOR_BPS,
    LIQUIDATOR_INCENTIVE_BPS,
    TREASURY_FEE_BPS,
    AddressZero
  )
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10000000))
  await collateralPoolConfig.setDebtCeiling(COLLATERAL_POOL_ID, WeiPerRad.mul(10000000))
  await accessControlConfig.grantRole(await accessControlConfig.PRICE_ORACLE_ROLE(), deployer.address)
  await collateralPoolConfig.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

  const StablecoinAdapter = (await ethers.getContractFactory(
    "StablecoinAdapter",
    deployer
  )) as StablecoinAdapter__factory
  const stablecoinAdapter = (await upgrades.deployProxy(StablecoinAdapter, [
    bookKeeper.address,
    alpacaStablecoin.address,
  ])) as StablecoinAdapter
  await stablecoinAdapter.deployed()
  await bookKeeper.whitelist(stablecoinAdapter.address)

  await alpacaStablecoin.grantRole(await alpacaStablecoin.MINTER_ROLE(), stablecoinAdapter.address)

  const AlpacaStablecoinProxyActions = new AlpacaStablecoinProxyActions__factory(deployer)
  const alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions = await AlpacaStablecoinProxyActions.deploy()

  const SystemDebtEngine = (await ethers.getContractFactory("SystemDebtEngine", deployer)) as SystemDebtEngine__factory
  const systemDebtEngine = (await upgrades.deployProxy(SystemDebtEngine, [bookKeeper.address])) as SystemDebtEngine

  await factoryV2.createPair(BUSD.address, wbnb.address)
  await factoryV2.createPair(cake.address, wbnb.address)

  // Approve routerV2 to spend tokens
  Promise.all([
    await cake.approve(router.address, ethers.utils.parseEther("1000000")),
    await BUSD.approve(router.address, ethers.utils.parseEther("1000")),
    await wbnb.approve(router.address, ethers.utils.parseEther("50")),
  ])

  await cake["mint(uint256)"](ethers.utils.parseEther("10000000000"))
  await BUSD.mint(deployer.address, ethers.utils.parseEther("1000"))
  await wbnb.deposit({
    value: ethers.utils.parseEther("50"),
  })

  // Add liquidities
  Promise.all([
    // Add liquidity to the BTOKEN-WBNB pool on Pancakeswap
    await router.addLiquidity(
      BUSD.address,
      wbnb.address,
      ethers.utils.parseEther("1000"),
      ethers.utils.parseEther("1"),
      "0",
      "0",
      deployer.address,
      FOREVER
    ),
    // Add liquidity to the CAKE-FTOKEN pool on Pancakeswap
    await router.addLiquidity(
      cake.address,
      wbnb.address,
      ethers.utils.parseEther("1000000"),
      ethers.utils.parseEther("40"),
      "0",
      "0",
      deployer.address,
      FOREVER
    ),
  ])

  // Transfer ownership so masterChef can mint CAKE
  await Promise.all([
    await cake.transferOwnership(masterChef.address),
    await syrup.transferOwnership(masterChef.address),
  ])

  // Set block base fee per gas to 0
  await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"])

  return {
    proxyWalletRegistry,
    stablecoinAdapter,
    bookKeeper,
    alpacaStablecoinProxyActions,
    positionManager,
    alpacaStablecoin,
    simplePriceFeed,
    systemDebtEngine,
    collateralPoolConfig,
    cake,
    masterChef,
    router,
    addStrat,
    lpToken,
    lpTokenAutoCompoundAdapter,
    busd: BUSD,
    wbnb,
    factoryV2,
  }
}

describe("LPTokenAutoCompoundAdapter", () => {
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
  let proxyWalletRegistry: ProxyWalletRegistry

  let proxyWalletRegistryAsAlice: ProxyWalletRegistry
  let proxyWalletRegistryAsBob: ProxyWalletRegistry

  let deployerProxyWallet: ProxyWallet
  let aliceProxyWallet: ProxyWallet

  let stablecoinAdapter: StablecoinAdapter
  let bookKeeper: BookKeeper
  let positionManager: PositionManager
  let alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  let alpacaStablecoin: AlpacaStablecoin
  let simplePriceFeed: SimplePriceFeed
  let systemDebtEngine: SystemDebtEngine
  let collateralPoolConfig: CollateralPoolConfig
  let cake: CakeToken
  let masterChef: PancakeMasterChef
  let router: PancakeRouterV2
  let addStrat: PancakeswapV2RestrictedStrategyAddBaseTokenOnly
  let lpToken: PancakePair
  let lpTokenAutoCompoundAdapter: LPTokenAutoCompoundAdapter
  let busd: BEP20
  let wbnb: WETH
  let factoryV2: PancakeFactory

  let lpTokenAsAlice: PancakePair
  let lpTokenAsBob: PancakePair

  let lpTokenAutoCompoundAdapterAsAlice: LPTokenAutoCompoundAdapter
  let lpTokenAutoCompoundAdapterAsBob: LPTokenAutoCompoundAdapter

  let routerAsAlice: PancakeRouterV2
  let routerAsBob: PancakeRouterV2

  let busdAsAlice: BEP20
  let busdAsBob: BEP20

  let alpacaStablecoinAsAlice: AlpacaStablecoin
  let alpacaStablecoinAsBob: AlpacaStablecoin

  // Signer

  before(async () => {
    ;({
      proxyWallets: [deployerProxyWallet, aliceProxyWallet],
    } = await waffle.loadFixture(loadProxyWalletFixtureHandler))
  })

  beforeEach(async () => {
    ;({
      proxyWalletRegistry,
      stablecoinAdapter,
      bookKeeper,
      alpacaStablecoinProxyActions,
      positionManager,
      alpacaStablecoin,
      simplePriceFeed,
      systemDebtEngine,
      collateralPoolConfig,
      cake,
      router,
      addStrat,
      masterChef,
      lpToken,
      lpTokenAutoCompoundAdapter,
      busd,
      wbnb,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])
    proxyWalletRegistryAsAlice = ProxyWalletRegistry__factory.connect(proxyWalletRegistry.address, alice)
    proxyWalletRegistryAsBob = ProxyWalletRegistry__factory.connect(proxyWalletRegistry.address, bob)

    lpTokenAsAlice = PancakePair__factory.connect(lpToken.address, alice)
    lpTokenAsBob = PancakePair__factory.connect(lpToken.address, bob)

    lpTokenAutoCompoundAdapterAsAlice = LPTokenAutoCompoundAdapter__factory.connect(
      lpTokenAutoCompoundAdapter.address,
      alice
    )
    lpTokenAutoCompoundAdapterAsBob = LPTokenAutoCompoundAdapter__factory.connect(
      lpTokenAutoCompoundAdapter.address,
      bob
    )

    routerAsAlice = PancakeRouterV2__factory.connect(router.address, alice)
    routerAsBob = PancakeRouterV2__factory.connect(router.address, bob)

    busdAsAlice = BEP20__factory.connect(busd.address, alice)
    busdAsBob = BEP20__factory.connect(busd.address, bob)

    await bookKeeper.mintUnbackedStablecoin(
      deployerAddress,
      deployerAddress,
      ethers.utils.parseEther("100000").mul(WeiPerRay)
    )
    await stablecoinAdapter.withdraw(deployerAddress, ethers.utils.parseEther("1000"), "0x")
    await stablecoinAdapter.withdraw(aliceAddress, ethers.utils.parseEther("1000"), "0x")
    await stablecoinAdapter.withdraw(bobAddress, ethers.utils.parseEther("1000"), "0x")
    await busd.mint(deployerAddress, ethers.utils.parseEther("1000"))
    await busd.mint(aliceAddress, ethers.utils.parseEther("1000"))
    await busd.mint(bobAddress, ethers.utils.parseEther("1000"))

    alpacaStablecoinAsAlice = AlpacaStablecoin__factory.connect(alpacaStablecoin.address, alice)
    alpacaStablecoinAsBob = AlpacaStablecoin__factory.connect(alpacaStablecoin.address, bob)
  })

  describe("#initialize", async () => {
    context("when collateralToken not match with MasterChef", async () => {
      it("should revert", async () => {
        const LPTokenAutoCompoundAdapter = (await ethers.getContractFactory(
          "LPTokenAutoCompoundAdapter",
          deployer
        )) as LPTokenAutoCompoundAdapter__factory
        await expect(
          upgrades.deployProxy(LPTokenAutoCompoundAdapter, [
            bookKeeper.address,
            COLLATERAL_POOL_ID,
            cake.address,
            cake.address,
            masterChef.address,
            1,
            BigNumber.from(1000),
            deployerAddress,
            positionManager.address,
            router.address,
            cake.address,
            addStrat.address,
          ])
        ).to.be.revertedWith("LPTokenAutoCompoundAdapter/collateralToken-not-match")
      })
    })

    context("when rewardToken not match with MasterChef", async () => {
      it("should revert", async () => {
        const LPTokenAutoCompoundAdapter = (await ethers.getContractFactory(
          "LPTokenAutoCompoundAdapter",
          deployer
        )) as LPTokenAutoCompoundAdapter__factory
        await expect(
          upgrades.deployProxy(LPTokenAutoCompoundAdapter, [
            bookKeeper.address,
            COLLATERAL_POOL_ID,
            lpToken.address,
            lpToken.address,
            masterChef.address,
            1,
            BigNumber.from(1000),
            deployerAddress,
            positionManager.address,
            router.address,
            cake.address,
            addStrat.address,
          ])
        ).to.be.revertedWith("LPTokenAutoCompoundAdapter/reward-token-not-match")
      })
    })

    context("when all assumptions are correct", async () => {
      it("should initalized correctly", async () => {
        expect(await lpTokenAutoCompoundAdapter.bookKeeper()).to.be.eq(bookKeeper.address)
        expect(await lpTokenAutoCompoundAdapter.collateralPoolId()).to.be.eq(COLLATERAL_POOL_ID)
        expect(await lpTokenAutoCompoundAdapter.collateralToken()).to.be.eq(lpToken.address)
        expect(await lpTokenAutoCompoundAdapter.masterChef()).to.be.eq(masterChef.address)
        expect(await lpTokenAutoCompoundAdapter.pid()).to.be.eq(1)
        expect(await lpTokenAutoCompoundAdapter.decimals()).to.be.eq(18)
        expect(await lpTokenAutoCompoundAdapter.router()).to.be.eq(router.address)
        expect(await lpTokenAutoCompoundAdapter.baseToken()).to.be.eq(busd.address)
        expect(await lpTokenAutoCompoundAdapter.addStrat()).to.be.eq(addStrat.address)
      })
    })
  })

  describe("#netAssetValuation", async () => {
    context("when all collateral tokens are deposited by deposit function", async () => {
      it("should return the correct net asset valuation", async () => {
        await busd.approve(router.address, ethers.utils.parseEther("1000"))
        await alpacaStablecoin.approve(router.address, ethers.utils.parseEther("1000"))

        await router.addLiquidity(
          busd.address,
          alpacaStablecoin.address,
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("100"),
          0,
          0,
          deployerAddress,
          FOREVER
        )

        await lpToken.approve(lpTokenAutoCompoundAdapter.address, ethers.utils.parseEther("1"))
        await lpTokenAutoCompoundAdapter.deposit(
          deployerAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [deployerAddress])
        )

        expect(await lpTokenAutoCompoundAdapter.netAssetValuation()).to.be.eq(ethers.utils.parseEther("1"))

        await lpTokenAutoCompoundAdapter.withdraw(
          deployerAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [deployerAddress])
        )
        expect(await lpTokenAutoCompoundAdapter.netAssetValuation()).to.be.eq("0")
      })
    })

    context("when some one directly transfer collateral tokens to LPTokenAutoCompoundAdapter", async () => {
      it("should reinvest the directly transferred fund to MasterChef", async () => {
        await busd.approve(router.address, ethers.utils.parseEther("1000"))
        await alpacaStablecoin.approve(router.address, ethers.utils.parseEther("1000"))

        await router.addLiquidity(
          busd.address,
          alpacaStablecoin.address,
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("100"),
          0,
          0,
          deployerAddress,
          FOREVER
        )

        await lpToken.approve(lpTokenAutoCompoundAdapter.address, ethers.utils.parseEther("1"))
        await lpTokenAutoCompoundAdapter.deposit(
          deployerAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [deployerAddress])
        )

        await lpToken.transfer(lpTokenAutoCompoundAdapter.address, ethers.utils.parseEther("88"))

        expect(await lpToken.balanceOf(lpTokenAutoCompoundAdapter.address)).to.be.eq(ethers.utils.parseEther("88"))
        expect(await lpTokenAutoCompoundAdapter.netAssetValuation()).to.be.eq(ethers.utils.parseEther("1"))

        await lpTokenAutoCompoundAdapter.withdraw(
          aliceAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
        )

        expect(await lpToken.balanceOf(lpTokenAutoCompoundAdapter.address)).to.be.eq(ethers.utils.parseEther("0"))
        expect(await lpTokenAutoCompoundAdapter.netAssetValuation()).to.be.eq("0")
      })
    })
  })

  describe("#netAssetPerShare", async () => {
    context("when all collateral tokens are deposited by deposit function", async () => {
      it("should return the correct net asset per share", async () => {
        await busd.approve(router.address, ethers.utils.parseEther("1000"))
        await alpacaStablecoin.approve(router.address, ethers.utils.parseEther("1000"))

        await router.addLiquidity(
          busd.address,
          alpacaStablecoin.address,
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("100"),
          0,
          0,
          deployerAddress,
          FOREVER
        )

        await lpToken.approve(lpTokenAutoCompoundAdapter.address, ethers.utils.parseEther("8"))
        await lpTokenAutoCompoundAdapter.deposit(
          deployerAddress,
          ethers.utils.parseEther("8"),
          ethers.utils.defaultAbiCoder.encode(["address"], [deployerAddress])
        )

        // Expect netAssetPerShare = 1 as share = asset
        expect(await lpTokenAutoCompoundAdapter.netAssetPerShare()).to.be.eq(ethers.utils.parseEther("1"))

        await lpTokenAutoCompoundAdapter.withdraw(
          deployerAddress,
          ethers.utils.parseEther("7"),
          ethers.utils.defaultAbiCoder.encode(["address"], [deployerAddress])
        )
        expect(await lpTokenAutoCompoundAdapter.netAssetPerShare()).to.be.eq("1000124219245559163")

        await lpTokenAutoCompoundAdapter.withdraw(
          deployerAddress,
          ethers.utils.parseEther("1"),
          ethers.utils.defaultAbiCoder.encode(["address"], [deployerAddress])
        )
        // If total share = 0, the net asset per share = WAD
        expect(await lpTokenAutoCompoundAdapter.netAssetPerShare()).to.be.eq(ethers.utils.parseEther("1"))
      })
    })

    describe("#deposit", async () => {
      context("when LPTokenAutoCompoundAdapter is not live", async () => {
        it("should revert", async () => {
          // Cage LPTokenAutoCompoundAdapter
          await lpTokenAutoCompoundAdapter.cage()
          await expect(
            lpTokenAutoCompoundAdapter.deposit(
              deployerAddress,
              ethers.utils.parseEther("1"),
              ethers.utils.defaultAbiCoder.encode(["address"], [deployerAddress])
            )
          ).to.be.revertedWith("LPTokenAutoCompoundAdapter/not live")
        })
      })

      context("when all parameters are valid", async () => {
        it.only("should work", async () => {
          // Assuming Alice is the first one to deposit hence no rewards to be harvested yet
          await busdAsAlice.approve(router.address, ethers.utils.parseEther("1000"))
          await alpacaStablecoinAsAlice.approve(router.address, ethers.utils.parseEther("1000"))

          await routerAsAlice.addLiquidity(
            busd.address,
            alpacaStablecoin.address,
            ethers.utils.parseEther("100"),
            ethers.utils.parseEther("100"),
            0,
            0,
            aliceAddress,
            FOREVER
          )

          await lpTokenAsAlice.approve(lpTokenAutoCompoundAdapter.address, ethers.utils.parseEther("8"))
          await lpTokenAutoCompoundAdapterAsAlice.deposit(
            aliceAddress,
            ethers.utils.parseEther("8"),
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
          )

          const aliceStake1 = await lpTokenAutoCompoundAdapter.stake(aliceAddress)
          const netAssetPerShare1 = await lpTokenAutoCompoundAdapter.netAssetPerShare()
          const aliceNetAssetValue1 = aliceStake1.mul(netAssetPerShare1)
          expect(await cake.balanceOf(lpTokenAutoCompoundAdapter.address)).to.be.eq(0)
          expect(await lpTokenAutoCompoundAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("8"))
          expect(aliceStake1).to.be.eq(ethers.utils.parseEther("8"))

          // Now Alice harvest rewards. 1 block has been passed, hence Alice's net asset value should grow
          await lpTokenAutoCompoundAdapterAsAlice.deposit(
            aliceAddress,
            0,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress])
          )

          const aliceStake2 = await lpTokenAutoCompoundAdapter.stake(aliceAddress)
          const netAssetPerShare2 = await lpTokenAutoCompoundAdapter.netAssetPerShare()
          const aliceNetAssetValue2 = aliceStake2.mul(netAssetPerShare2)
          expect(await cake.balanceOf(lpTokenAutoCompoundAdapter.address)).to.be.eq(0)
          expect(await lpTokenAutoCompoundAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("8"))
          expect(aliceStake2).to.be.eq(ethers.utils.parseEther("8"))
          expect(netAssetPerShare2).to.be.eq("1000124219245559157")
          expect(await lpTokenAutoCompoundAdapter.netAssetValuation()).to.be.eq("8000993753964473262")
          expect(aliceNetAssetValue2, "Alice's net asset value should grow from reinvest.").to.be.gt(
            aliceNetAssetValue1
          )

          // Bob join the party! As 2 blocks moved. LPTokenAutoCompoundAdapter
          await busdAsBob.approve(router.address, ethers.utils.parseEther("1000"))
          await alpacaStablecoinAsBob.approve(router.address, ethers.utils.parseEther("1000"))

          await routerAsBob.addLiquidity(
            busd.address,
            alpacaStablecoin.address,
            ethers.utils.parseEther("100"),
            ethers.utils.parseEther("100"),
            0,
            0,
            bobAddress,
            FOREVER
          )

          await lpTokenAsBob.approve(lpTokenAutoCompoundAdapter.address, ethers.utils.parseEther("8"))
          console.log((await lpTokenAsBob.balanceOf(bobAddress)).toString())
          await lpTokenAutoCompoundAdapterAsBob.deposit(
            bobAddress,
            ethers.utils.parseEther("4"),
            ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress])
          )

          const aliceStake3 = await lpTokenAutoCompoundAdapter.stake(aliceAddress)
          const netAssetPerShare3 = await lpTokenAutoCompoundAdapter.netAssetPerShare()
          const aliceNetAssetValue3 = aliceStake3.mul(netAssetPerShare3)
          const bobStake1 = await lpTokenAutoCompoundAdapter.stake(bobAddress)
          expect(await lpTokenAutoCompoundAdapter.totalShare()).to.be.eq("11997021032030271049")
          expect(aliceStake3).to.be.eq(ethers.utils.parseEther("8"))
          expect(bobStake1).to.be.eq("3997021032030271049")
          expect(netAssetPerShare3).to.be.eq("1000745297046439557")
          expect(await lpTokenAutoCompoundAdapter.netAssetValuation()).to.be.eq("12005962376371516458")
          expect(aliceNetAssetValue3, "Alice's net asset value should grow from reinvest.").to.be.gt(
            aliceNetAssetValue2
          )
          AssertHelpers.assertAlmostEqual(
            bobStake1.mul(netAssetPerShare3).toString(),
            ethers.utils.parseEther("3.999").toString()
          ) // Bob's net asset value should be equal to the amount Bob deposited with some precision loss

          // Bob harvest ALPACA. LPTokenAutoCompoundAdapter earned another 100 ALPACA.
          // LPTokenAutoCompoundAdapter has another 100 ALPACA from previous block. Hence,
          // balanceOf(address(this)) should return 300 ALPACA.
          // Bob should get 72 (80 - 10%) ALPACA, treasury account should get 8 ALPACA.
          await lpTokenAutoCompoundAdapterAsBob.deposit(
            bobAddress,
            0,
            ethers.utils.defaultAbiCoder.encode(["address"], [bobAddress])
          )

          // expect(await alpacaToken.balanceOf(ibTokenAdapter.address)).to.be.eq(ethers.utils.parseEther("220"))
          // expect(await alpacaToken.balanceOf(aliceAddress)).to.be.eq(ethers.utils.parseEther("90"))
          // expect(await alpacaToken.balanceOf(bobAddress)).to.be.eq(ethers.utils.parseEther("72"))
          // expect(await ibTokenAdapter.totalShare()).to.be.eq(ethers.utils.parseEther("5"))
          // expect(await ibTokenAdapter.accRewardPerShare()).to.be.eq(weiToRay(ethers.utils.parseEther("320")))
          // expect(await ibTokenAdapter.accRewardBalance()).to.be.eq(ethers.utils.parseEther("220"))
          // expect(await ibTokenAdapter.stake(aliceAddress)).to.be.eq(ethers.utils.parseEther("1"))
          // expect(await ibTokenAdapter.rewardDebts(aliceAddress)).to.be.eq(ethers.utils.parseEther("100"))
          // expect(await ibTokenAdapter.stake(bobAddress)).to.be.eq(ethers.utils.parseEther("4"))
          // expect(await ibTokenAdapter.rewardDebts(bobAddress)).to.be.eq(ethers.utils.parseEther("1280"))
          // expect(await alpacaToken.balanceOf(devAddress)).to.be.eq(ethers.utils.parseEther("18"))
        })
      })
    })
  })
})
