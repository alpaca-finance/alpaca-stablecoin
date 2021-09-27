import { ethers, upgrades, waffle } from "hardhat"
import { BigNumber, Contract, ContractReceipt, Event, EventFilter, Signer } from "ethers"

import {
  ProxyWalletRegistry__factory,
  ProxyWalletFactory__factory,
  ProxyWalletRegistry,
  ProxyWallet__factory,
  ProxyWallet,
  PositionManager__factory,
  BookKeeper,
  BookKeeper__factory,
  PositionManager,
  AlpacaStablecoinProxyActions,
  AlpacaStablecoinProxyActions__factory,
  IbTokenAdapter__factory,
  BEP20__factory,
  AlpacaToken__factory,
  FairLaunch__factory,
  Shield__factory,
  IbTokenAdapter,
} from "../../../typechain"
import { expect } from "chai"
import { AddressZero } from "../../helper/address"
import { loadProxyWalletFixtureHandler } from "../../helper/proxy"
import { formatBytes32String } from "ethers/lib/utils"
import { deploy } from "@openzeppelin/hardhat-upgrades/dist/utils"
import { expectEmit, getEvent } from "../../helper/event"
import {
  DebtToken__factory,
  MockWBNB,
  MockWBNB__factory,
  SimpleVaultConfig__factory,
  Vault,
  Vault__factory,
  WNativeRelayer,
  WNativeRelayer__factory,
} from "@alpaca-finance/alpaca-contract/typechain"
import { WeiPerWad } from "../../helper/unit"

type Fixture = {
  positionManager: PositionManager
  alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  bookKeeper: BookKeeper
  ibTokenAdapter: IbTokenAdapter
  vault: Vault
}

const loadFixtureHandler = async (): Promise<Fixture> => {
  const [deployer, alice, , dev] = await ethers.getSigners()

  // alpca vault
  const ALPACA_BONUS_LOCK_UP_BPS = 7000
  const ALPACA_REWARD_PER_BLOCK = ethers.utils.parseEther("5000")
  const RESERVE_POOL_BPS = "1000" // 10% reserve pool
  const KILL_PRIZE_BPS = "1000" // 10% Kill prize
  const INTEREST_RATE = "3472222222222" // 30% per year
  const MIN_DEBT_SIZE = ethers.utils.parseEther("1") // 1 BTOKEN min debt size
  const KILL_TREASURY_BPS = "100"

  const WBNB = new MockWBNB__factory(deployer)
  const wbnb = (await WBNB.deploy()) as MockWBNB
  await wbnb.deployed()

  const WNativeRelayer = new WNativeRelayer__factory(deployer)
  const wNativeRelayer = (await WNativeRelayer.deploy(wbnb.address)) as WNativeRelayer
  await wNativeRelayer.deployed()

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const ibDUMMY = await BEP20.deploy("ibDUMMY", "ibDUMMY")
  await ibDUMMY.deployed()

  const baseToken = await BEP20.deploy("BTOKEN", "BTOKEN")
  await baseToken.deployed()
  await baseToken.mint(await deployer.getAddress(), ethers.utils.parseEther("100"))
  await baseToken.mint(await alice.getAddress(), ethers.utils.parseEther("100"))

  const DebtToken = new DebtToken__factory(deployer)
  const debtToken = await DebtToken.deploy()
  await debtToken.deployed()
  await debtToken.initialize("debtibBTOKEN_V2", "debtibBTOKEN_V2", deployer.address)

  // Setup FairLaunch contract
  // Deploy ALPACAs
  const AlpacaToken = new AlpacaToken__factory(deployer)
  const alpacaToken = await AlpacaToken.deploy(132, 137)
  await alpacaToken.deployed()

  const FairLaunch = new FairLaunch__factory(deployer)
  const fairLaunch = await FairLaunch.deploy(
    alpacaToken.address,
    deployer.address,
    ALPACA_REWARD_PER_BLOCK,
    0,
    ALPACA_BONUS_LOCK_UP_BPS,
    0
  )
  await fairLaunch.deployed()

  const Shield = (await ethers.getContractFactory("Shield", deployer)) as Shield__factory
  const shield = await Shield.deploy(deployer.address, fairLaunch.address)
  await shield.deployed()

  const SimpleVaultConfig = new SimpleVaultConfig__factory(deployer)
  const simpleVaultConfig = await SimpleVaultConfig.deploy()
  await simpleVaultConfig.deployed()
  await simpleVaultConfig.initialize(
    MIN_DEBT_SIZE,
    INTEREST_RATE,
    RESERVE_POOL_BPS,
    KILL_PRIZE_BPS,
    wbnb.address,
    wNativeRelayer.address,
    fairLaunch.address,
    KILL_TREASURY_BPS,
    deployer.address
  )

  const Vault = new Vault__factory(deployer)
  const busdVault = await Vault.deploy()
  await busdVault.deployed()
  await busdVault.initialize(
    simpleVaultConfig.address,
    baseToken.address,
    "Interest Bearing BTOKEN",
    "ibBTOKEN",
    18,
    debtToken.address
  )

  // Config Alpaca's FairLaunch
  // Assuming Deployer is timelock for easy testing
  await fairLaunch.addPool(1, busdVault.address, true)
  await fairLaunch.transferOwnership(shield.address)
  await shield.transferOwnership(await deployer.getAddress())
  await alpacaToken.transferOwnership(fairLaunch.address)

  const BookKeeper = new BookKeeper__factory(deployer)
  const bookKeeper = (await upgrades.deployProxy(BookKeeper)) as BookKeeper

  await bookKeeper.init(formatBytes32String("ibBUSD"))

  const PositionManager = new PositionManager__factory(deployer)
  const positionManager = (await upgrades.deployProxy(PositionManager, [bookKeeper.address])) as PositionManager

  const AlpacaStablecoinProxyActions = new AlpacaStablecoinProxyActions__factory(deployer)
  const alpacaStablecoinProxyActions = await AlpacaStablecoinProxyActions.deploy()

  const IbTokenAdapter = (await ethers.getContractFactory("IbTokenAdapter", deployer)) as IbTokenAdapter__factory
  const ibTokenAdapter = (await upgrades.deployProxy(IbTokenAdapter, [
    bookKeeper.address,
    formatBytes32String("ibBUSD"),
    busdVault.address,
    alpacaToken.address,
    fairLaunch.address,
    0,
    shield.address,
    await deployer.getAddress(),
    BigNumber.from(1000),
    await dev.getAddress(),
  ])) as IbTokenAdapter

  return { alpacaStablecoinProxyActions, positionManager, bookKeeper, ibTokenAdapter, vault: busdVault }
}

describe("position manager", () => {
  // Proxy wallet
  let deployerProxyWallet: ProxyWallet
  let aliceProxyWallet: ProxyWallet
  let bobProxyWallet: ProxyWallet

  // Contract
  let positionManager: PositionManager
  let alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  let bookKeeper: BookKeeper
  let ibTokenAdapter: IbTokenAdapter
  let vault: Vault

  beforeEach(async () => {
    ;({
      proxyWallets: [deployerProxyWallet, aliceProxyWallet, bobProxyWallet],
    } = await waffle.loadFixture(loadProxyWalletFixtureHandler))
    ;({ alpacaStablecoinProxyActions, positionManager, bookKeeper, ibTokenAdapter, vault } = await waffle.loadFixture(
      loadFixtureHandler
    ))
  })
  describe("user opens a new position", () => {
    context("alice opens a new position", () => {
      it("alice should be able to open a position", async () => {
        // alice open a new position
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("open", [
          positionManager.address,
          formatBytes32String("ibBUSD"),
          aliceProxyWallet.address,
        ])
        const tx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          openPositionCall
        )
        const txReceipt = await tx.wait()

        const event = await getEvent(positionManager, txReceipt.blockNumber, "NewPosition")
        expectEmit(event, aliceProxyWallet.address, aliceProxyWallet.address, 1)

        expect(await positionManager.ownerLastPositionId(aliceProxyWallet.address)).to.be.equal(1)
      })
    })
  })
  describe("", () => {
    context("", () => {
      it("", async () => {
        // alice open a new position
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("open", [
          positionManager.address,
          formatBytes32String("ibBUSD"),
          aliceProxyWallet.address,
        ])
        const openTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          openPositionCall
        )

        const positonId = await positionManager.ownerLastPositionId(aliceProxyWallet.address)

        // alice convert BUSD to ibBUSD
        const convertCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("tokenToIbToken", [
          vault.address,
          WeiPerWad.mul(10),
        ])
        const convertTx = await aliceProxyWallet["execute(address,bytes)"](
          alpacaStablecoinProxyActions.address,
          convertCall
        )

        // // alice lock callateral
        // const lockCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("lockToken", [
        //   positionManager.address,
        //   ibTokenAdapter.address,
        //   positonId,
        //   WeiPerWad.mul(10),
        //   true,
        //   ethers.utils.defaultAbiCoder.encode(["address"], [aliceProxyWallet.address]),
        // ])
        // const lockTx = await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, lockCall)
      })
    })
  })
})
