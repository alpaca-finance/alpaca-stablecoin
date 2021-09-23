import { ethers, upgrades } from "hardhat"

import {
  ProxyWalletRegistry__factory,
  ProxyWalletFactory__factory,
  ProxyWalletRegistry,
  ProxyWallet,
  ProxyWallet__factory,
} from "../../typechain"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

type proxyWalletFixture = {
  proxyWallets: ProxyWallet[]
}

export const loadProxyWalletFixtureHandler = async (): Promise<proxyWalletFixture> => {
  const signers = await ethers.getSigners()
  const deployer = signers[0]
  const ProxyWalletFactory = new ProxyWalletFactory__factory(deployer)
  const proxyWalletFactory = await ProxyWalletFactory.deploy()

  const ProxyWalletRegistry = new ProxyWalletRegistry__factory(deployer)
  const proxyWalletRegistry = (await upgrades.deployProxy(ProxyWalletRegistry, [
    proxyWalletFactory.address,
  ])) as ProxyWalletRegistry

  const proxyWallets = await Promise.all(
    signers.map(async (singer: SignerWithAddress) => {
      await proxyWalletRegistry["build(address)"](singer.address)
      const proxyWalletAddress = await proxyWalletRegistry.proxies(singer.address)
      const proxyWallet = await ProxyWallet__factory.connect(proxyWalletAddress, singer)
      return proxyWallet
    })
  )

  return { proxyWallets }
}
