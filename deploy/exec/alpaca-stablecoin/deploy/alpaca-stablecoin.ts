import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { AlpacaStablecoin__factory } from "../../../../typechain"

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

  const NAME = ""
  const SYMBOL = ""
  const CHAIN_ID = ""

  console.log(">> Deploying an upgradable AlpacaStablecoin contract")
  const AlpacaStablecoin = (await ethers.getContractFactory(
    "AlpacaStablecoin",
    (
      await ethers.getSigners()
    )[0]
  )) as AlpacaStablecoin__factory
  const alpacaStablecoin = await upgrades.deployProxy(AlpacaStablecoin, [NAME, SYMBOL, CHAIN_ID])
  await alpacaStablecoin.deployed()
  console.log(`>> Deployed at ${alpacaStablecoin.address}`)
}

export default func
func.tags = ["AlpacaStablecoin"]