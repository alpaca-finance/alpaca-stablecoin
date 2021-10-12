import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { AlpacaStablecoinProxyActions__factory } from "../../../../../typechain"

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

  console.log(">> Deploying an upgradable AlpacaStablecoinProxyAction contract")
  const AlpacaStablecoinProxyAction = (await ethers.getContractFactory(
    "AlpacaStablecoinProxyAction",
    (
      await ethers.getSigners()
    )[0]
  )) as AlpacaStablecoinProxyActions__factory
  const alpacaStablecoinProxyAction = await AlpacaStablecoinProxyAction.deploy()
  await alpacaStablecoinProxyAction.deployed()
  console.log(`>> Deployed at ${alpacaStablecoinProxyAction.address}`)
}

export default func
func.tags = ["AlpacaStablecoinProxyAction"]
