import { ethers, upgrades } from "hardhat"
import { Signer } from "ethers"

import {
  ProxyWalletRegistry__factory,
  ProxyWalletFactory__factory,
  ProxyWalletRegistry,
  ProxyWallet__factory,
} from "../../../typechain"
import { expect } from "chai"
import { AddressZero } from "../../helper/address"

type proxyWalletFixture = {
  proxyWalletRegistry: ProxyWalletRegistry
}

const loadFixtureHandler = async (): Promise<proxyWalletFixture> => {
  const [deployer] = await ethers.getSigners()
  const ProxyWalletFactory = new ProxyWalletFactory__factory(deployer)
  const proxyWalletFactory = await ProxyWalletFactory.deploy()

  const ProxyWalletRegistry = new ProxyWalletRegistry__factory(deployer)
  const proxyWalletRegistry = (await upgrades.deployProxy(ProxyWalletRegistry, [
    proxyWalletFactory.address,
  ])) as ProxyWalletRegistry

  return { proxyWalletRegistry }
}

describe("ProxyWallet", () => {
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

  // Contract
  let proxyWalletRegistry: ProxyWalletRegistry

  let proxyWalletRegistryAsAlice: ProxyWalletRegistry
  let proxyWalletRegistryAsBob: ProxyWalletRegistry

  beforeEach(async () => {
    ;({ proxyWalletRegistry } = await loadFixtureHandler())
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])
    proxyWalletRegistryAsAlice = ProxyWalletRegistry__factory.connect(proxyWalletRegistry.address, alice)
    proxyWalletRegistryAsBob = ProxyWalletRegistry__factory.connect(proxyWalletRegistry.address, bob)
  })
  describe("#new user create a new proxy wallet", async () => {
    context("alice create a new proxy wallet", async () => {
      it("alice should be able to create a proxy wallet", async () => {
        expect(await proxyWalletRegistry.proxies(aliceAddress)).to.be.equal(AddressZero)
        // #1 alice create a proxy wallet
        await proxyWalletRegistryAsAlice["build()"]()
        const proxyWalletAliceAddress = await proxyWalletRegistry.proxies(aliceAddress)
        expect(proxyWalletAliceAddress).to.be.not.equal(AddressZero)
        const proxyWalletAsAlice = await ProxyWallet__factory.connect(proxyWalletAliceAddress, alice)
        expect(await proxyWalletAsAlice.owner()).to.be.equal(aliceAddress)
      })
    })
  })
  describe("#user already has a proxy wallet", async () => {
    context("alice already has a proxy wallet and alice creates a new proxy wallet", async () => {
      it("alice should not be able to create a proxy wallet", async () => {
        expect(await proxyWalletRegistry.proxies(aliceAddress)).to.be.equal(AddressZero)
        // #1 alice create a proxy wallet 1
        await proxyWalletRegistryAsAlice["build()"]()
        const proxyWalletAliceAddress = await proxyWalletRegistry.proxies(aliceAddress)
        expect(proxyWalletAliceAddress).to.be.not.equal(AddressZero)
        const proxyWalletAsAlice = await ProxyWallet__factory.connect(proxyWalletAliceAddress, alice)
        expect(await proxyWalletAsAlice.owner()).to.be.equal(aliceAddress)

        // #2 alice create a proxy wallet 2
        await expect(proxyWalletRegistryAsAlice["build()"]()).to.be.reverted
      })
    })
  })
  describe("#user want to change the owner of a proxy wallet", async () => {
    context("alice want to change the owner of a proxy wallet to bob, but bob already has proxy wallet", async () => {
      it("alice should not be able to change the owner of a proxy wallet", async () => {
        // #1 alice create a proxy wallet
        await proxyWalletRegistryAsAlice["build()"]()
        const proxyWalletAliceAddress = await proxyWalletRegistry.proxies(aliceAddress)
        expect(proxyWalletAliceAddress).to.be.not.equal(AddressZero)
        const proxyWalletAsAlice = await ProxyWallet__factory.connect(proxyWalletAliceAddress, alice)
        expect(await proxyWalletAsAlice.owner()).to.be.equal(aliceAddress)

        // #2 bob create a proxy wallet
        await proxyWalletRegistryAsBob["build()"]()
        const proxyWalletBobAddress = await proxyWalletRegistry.proxies(bobAddress)
        expect(proxyWalletBobAddress).to.be.not.equal(AddressZero)
        const proxyWalletAsBob = await ProxyWallet__factory.connect(proxyWalletBobAddress, bob)
        expect(await proxyWalletAsBob.owner()).to.be.equal(bobAddress)

        // #3 alice set bob to owner proxy wallet registry
        await expect(proxyWalletRegistryAsAlice.setOwner(bobAddress)).to.be.reverted
      })
    })
    context("alice only change the owner of a proxy wallet registry", async () => {
      it("alice should not be able to change the owner of a proxy wallet registry", async () => {
        // #1 alice create a proxy wallet
        await proxyWalletRegistryAsAlice["build()"]()
        const proxyWalletAliceAddress = await proxyWalletRegistry.proxies(aliceAddress)
        expect(proxyWalletAliceAddress).to.be.not.equal(AddressZero)
        const proxyWalletAsAlice = await ProxyWallet__factory.connect(proxyWalletAliceAddress, alice)
        expect(await proxyWalletAsAlice.owner()).to.be.equal(aliceAddress)

        // #2 alice set bob to owner proxy wallet registry
        await expect(proxyWalletRegistryAsAlice.setOwner(bobAddress)).to.be.reverted
      })
    })
    context("alice change the owner of a proxy wallet and proxy wallet registry", async () => {
      it("alice should be able to change the owner of a proxy wallet", async () => {
        // #1 alice create a proxy wallet
        await proxyWalletRegistryAsAlice["build()"]()
        const proxyWalletAliceAddress = await proxyWalletRegistry.proxies(aliceAddress)
        expect(proxyWalletAliceAddress).to.be.not.equal(AddressZero)
        const proxyWalletAsAlice = await ProxyWallet__factory.connect(proxyWalletAliceAddress, alice)
        expect(await proxyWalletAsAlice.owner()).to.be.equal(aliceAddress)

        // #2 alice set bob to owner proxy wallet
        await proxyWalletAsAlice.setOwner(bobAddress)
        expect(await proxyWalletAsAlice.owner()).to.be.equal(bobAddress)

        // #3 alice set bob to owner proxy wallet registry
        await proxyWalletRegistryAsAlice.setOwner(bobAddress)
        expect(await proxyWalletRegistry.proxies(bobAddress)).to.be.equal(proxyWalletAliceAddress)
        expect(await proxyWalletRegistry.proxies(aliceAddress)).to.be.equal(AddressZero)
      })
    })
  })
})
