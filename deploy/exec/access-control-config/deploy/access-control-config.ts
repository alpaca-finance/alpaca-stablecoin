import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { AccessControlConfig__factory } from "../../../../typechain"

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

  console.log(">> Deploying an upgradable AccessControlConfig contract")
  const AccessControlConfig = (await ethers.getContractFactory(
    "AccessControlConfig",
    (
      await ethers.getSigners()
    )[0]
  )) as AccessControlConfig__factory
  const accessControlConfig = await upgrades.deployProxy(AccessControlConfig)
  await accessControlConfig.deployed()
  console.log(`>> Deployed at ${accessControlConfig.address}`)
}

export default func
func.tags = ["AccessControlConfig"]
