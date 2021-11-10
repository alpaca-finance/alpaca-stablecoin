import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { PositionManager__factory } from "../../../../../typechain"
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

  const config = ConfigEntity.getConfig()

  console.log(">> Deploying an upgradable PositionManager contract")
  const PositionManager = (await ethers.getContractFactory(
    "PositionManager",
    (
      await ethers.getSigners()
    )[0]
  )) as PositionManager__factory
  const positionManager = await upgrades.deployProxy(PositionManager, [
    config.BookKeeper.address,
    config.ShowStopper.address,
  ])
  await positionManager.deployed()
  console.log(`>> Deployed at ${positionManager.address}`)
  const tx = await positionManager.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["PositionManager"]
