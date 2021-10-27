import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { AlpacaStablecoinProxyActions__factory } from "../../../../../typechain"
import { ConfigEntity } from "../../../../entities"

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

  console.log(">> Deploying an AlpacaStablecoinProxyAction contract")
  const AlpacaStablecoinProxyActions = (await ethers.getContractFactory(
    "AlpacaStablecoinProxyActions",
    (
      await ethers.getSigners()
    )[0]
  )) as AlpacaStablecoinProxyActions__factory
  const alpacaStablecoinProxyActions = await AlpacaStablecoinProxyActions.deploy()
  await alpacaStablecoinProxyActions.deployed()
  console.log(`>> Deployed at ${alpacaStablecoinProxyActions.address}`)
  const tx = await alpacaStablecoinProxyActions.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["AlpacaStablecoinProxyActions"]
