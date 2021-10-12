import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { ProxyWalletRegistry__factory } from "../../../../../typechain"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  /*
  ░██╗░░░░░░░██╗░█████╗░██████╗░███╗░░██╗██╗███╗░░██╗░██████╗░
  ░██║░░██╗░░██║██╔══██╗██╔══██╗████╗░██║██║████╗░██║██╔════╝░
  ░╚██╗████╗██╔╝███████║██████╔╝██╔██╗██║██║██╔██╗██║██║░░██╗░
  ░░████╔═████║░██╔══██║██╔══██╗██║╚████║██║██║╚████║██║░░╚██╗
  ░░╚██╔╝░╚██╔╝░██║░░██║██║░░██║██║░╚███║██║██║░╚███║╚██████╔╝
  ░░░╚═╝░░░╚═╝░░╚═╝░░╚═╝╚═╝░░╚═╝╚═╝░░╚══╝╚═╝╚═╝░░╚══╝░╚═════╝░
  Check all variables below before execute the deployment script
  */

  const PROXY_WALLET_FACTORY_ADDR = ""

  console.log(">> Deploying an upgradable ProxyWalletRegistry contract")
  const ProxyWalletRegistry = (await ethers.getContractFactory(
    "ProxyWalletRegistry",
    (
      await ethers.getSigners()
    )[0]
  )) as ProxyWalletRegistry__factory
  const proxyWalletRegistry = await upgrades.deployProxy(ProxyWalletRegistry, [PROXY_WALLET_FACTORY_ADDR])
  await proxyWalletRegistry.deployed()
  console.log(`>> Deployed at ${proxyWalletRegistry.address}`)
}

export default func
func.tags = ["ProxyWalletRegistry"]
