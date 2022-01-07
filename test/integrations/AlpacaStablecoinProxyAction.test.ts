import { ethers, upgrades, waffle, network } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai, { expect } from "chai"
import "@openzeppelin/test-helpers"
import {
  BEP20,
  BEP20__factory,
  ProxyWallet,
  AlpacaStablecoinProxyActions,
  AlpacaStablecoinProxyActions__factory,
} from "../../typechain"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../helper/unit"
import {
  MockWBNB__factory,
  MockWBNB,
  WNativeRelayer,
  WNativeRelayer__factory,
  AlpacaToken__factory,
  FairLaunch__factory,
  SimpleVaultConfig__factory,
  Vault__factory,
  DebtToken__factory,
  Vault,
} from "@alpaca-finance/alpaca-contract/typechain"
import { loadProxyWalletFixtureHandler } from "../helper/proxy"

type fixture = {
  alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  baseToken: BEP20
  bnbVault: Vault
  tokenVault: Vault
  wbnb: MockWBNB
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer, alice] = await ethers.getSigners()

  const FOREVER = "2000000000"
  const ALPACA_BONUS_LOCK_UP_BPS = 7000
  const ALPACA_REWARD_PER_BLOCK = ethers.utils.parseEther("5000")
  const WEX_REWARD_PER_BLOCK = ethers.utils.parseEther("0.076")
  const REINVEST_BOUNTY_BPS = "100" // 1% reinvest bounty
  const RESERVE_POOL_BPS = "1000" // 10% reserve pool
  const KILL_PRIZE_BPS = "1000" // 10% Kill prize
  const INTEREST_RATE = "3472222222222" // 30% per year
  const MIN_DEBT_SIZE = ethers.utils.parseEther("1") // 1 BTOKEN min debt size
  const WORK_FACTOR = "7000"
  const KILL_FACTOR = "8000"
  const KILL_TREASURY_BPS = "100"

  const WBNB = new MockWBNB__factory(deployer)
  const wbnb = (await WBNB.deploy()) as MockWBNB
  await wbnb.deployed()

  const WNativeRelayer = new WNativeRelayer__factory(deployer)
  const wNativeRelayer = (await WNativeRelayer.deploy(wbnb.address)) as WNativeRelayer
  await wNativeRelayer.deployed()

  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const baseToken = await BEP20.deploy("BTOKEN", "BTOKEN")
  await baseToken.deployed()
  await baseToken.mint(await deployer.getAddress(), ethers.utils.parseEther("100"))

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
  const tokenVault = await Vault.deploy()
  await tokenVault.deployed()
  await tokenVault.initialize(
    simpleVaultConfig.address,
    baseToken.address,
    "Interest Bearing BTOKEN",
    "ibBTOKEN",
    18,
    debtToken.address
  )

  const bnbVault = await Vault.deploy()
  await bnbVault.deployed()
  await bnbVault.initialize(
    simpleVaultConfig.address,
    wbnb.address,
    "Interest Bearing BNB",
    "ibBNB",
    18,
    debtToken.address
  )

  await wNativeRelayer.setCallerOk([bnbVault.address], true)

  const AlpacaStablecoinProxyActions = new AlpacaStablecoinProxyActions__factory(deployer)
  const alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions = await AlpacaStablecoinProxyActions.deploy()

  return { alpacaStablecoinProxyActions, baseToken, bnbVault, tokenVault, wbnb }
}

type proxyWalletFixture = {
  proxyWallets: ProxyWallet[]
}

describe("AlpacaStablecoinProxyAction", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string

  let deployerProxyWallet: ProxyWallet
  let aliceProxyWallet: ProxyWallet

  let wbnb: MockWBNB

  let baseToken: BEP20

  let bnbVault: Vault
  let tokenVault: Vault

  let alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  let proxyWallet: ProxyWallet

  before(async () => {
    ;({
      proxyWallets: [deployerProxyWallet, aliceProxyWallet],
    } = await waffle.loadFixture(loadProxyWalletFixtureHandler))
  })

  beforeEach(async () => {
    ;({ alpacaStablecoinProxyActions, baseToken, bnbVault, tokenVault, wbnb } = await waffle.loadFixture(
      loadFixtureHandler
    ))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    await baseToken.approve(deployerProxyWallet.address, WeiPerWad.mul(10000))
    await wbnb.approve(deployerProxyWallet.address, WeiPerWad.mul(10000))
    await tokenVault.approve(deployerProxyWallet.address, WeiPerWad.mul(10000))
    await bnbVault.approve(deployerProxyWallet.address, WeiPerWad.mul(10000))
  })
  describe("#bnbToIbBNB", () => {
    context("when parameters are valid", () => {
      it("should able to call bnbToIbBNB", async () => {
        await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"])

        const bnbBefore = await deployer.getBalance()
        const ibBNBBefore = await bnbVault.balanceOf(deployerAddress)

        const bnbToIbBNBCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("bnbToIbBNB", [
          bnbVault.address,
          WeiPerWad.mul(3),
          true,
        ])
        await deployerProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bnbToIbBNBCall, {
          value: WeiPerWad.mul(3),
          gasPrice: 0,
        })

        const bnbAfter = await deployer.getBalance()
        expect(bnbBefore.sub(bnbAfter)).to.be.equal(WeiPerWad.mul(3))

        const ibBNBAfter = await bnbVault.balanceOf(deployerAddress)
        expect(ibBNBAfter.sub(ibBNBBefore)).to.be.equal(WeiPerWad.mul(3))
      })
    })
  })
  describe("#ibBNBToBNB", () => {
    context("when parameters are valid", () => {
      it("should able to call ibBNBToBNB", async () => {
        await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"])

        const bnbToIbBNBCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("bnbToIbBNB", [
          bnbVault.address,
          WeiPerWad.mul(3),
          true,
        ])
        await deployerProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, bnbToIbBNBCall, {
          value: WeiPerWad.mul(3),
          gasPrice: 0,
        })

        const bnbBefore = await deployer.getBalance()
        const ibBNBBefore = await bnbVault.balanceOf(deployerAddress)

        const ibBNBToBNBCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("ibBNBToBNB", [
          bnbVault.address,
          WeiPerWad.mul(2),
        ])
        await deployerProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, ibBNBToBNBCall, {
          gasPrice: 0,
        })

        const bnbAfter = await deployer.getBalance()
        expect(bnbAfter.sub(bnbBefore)).to.be.equal(WeiPerWad.mul(2))

        const ibBNBAfter = await bnbVault.balanceOf(deployerAddress)
        expect(ibBNBBefore.sub(ibBNBAfter)).to.be.equal(WeiPerWad.mul(2))
      })
    })
  })
  describe("#tokenToIbToken", () => {
    context("when parameters are valid", () => {
      it("should able to call tokenToIbToken", async () => {
        await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"])

        const baseTokenBefore = await baseToken.balanceOf(deployerAddress)
        const ibTokenBefore = await tokenVault.balanceOf(deployerAddress)

        const tokenToIbTokenCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("tokenToIbToken", [
          tokenVault.address,
          WeiPerWad.mul(10),
          true,
        ])
        await deployerProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, tokenToIbTokenCall)

        const baseTokenAfter = await baseToken.balanceOf(deployerAddress)
        expect(baseTokenBefore.sub(baseTokenAfter)).to.be.equal(WeiPerWad.mul(10))

        const ibTokenAfter = await tokenVault.balanceOf(deployerAddress)
        expect(ibTokenAfter.sub(ibTokenBefore)).to.be.equal(WeiPerWad.mul(10))
      })
    })
  })
  describe("#ibTokenToToken", () => {
    context("when parameters are valid", () => {
      it("should able to call ibTokenToToken", async () => {
        await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"])

        const tokenToIbTokenCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("tokenToIbToken", [
          tokenVault.address,
          WeiPerWad.mul(10),
          true,
        ])
        await deployerProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, tokenToIbTokenCall)

        const baseTokenBefore = await baseToken.balanceOf(deployerAddress)
        const ibTokenBefore = await tokenVault.balanceOf(deployerAddress)

        const ibTokenToTokenCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("ibTokenToToken", [
          tokenVault.address,
          WeiPerWad.mul(5),
        ])
        await deployerProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, ibTokenToTokenCall)

        const baseTokenAfter = await baseToken.balanceOf(deployerAddress)
        expect(baseTokenAfter.sub(baseTokenBefore)).to.be.equal(WeiPerWad.mul(5))

        const ibTokenAfter = await tokenVault.balanceOf(deployerAddress)
        expect(ibTokenBefore.sub(ibTokenAfter)).to.be.equal(WeiPerWad.mul(5))
      })
    })
  })
})
