import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { PositionManager__factory } from "../../../../../typechain"

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

  const BOOK_KEEPER_ADDR = ""
  const SHOW_STOPPER_ADDR = ""

  console.log(">> Deploying an upgradable PositionManager contract")
  const PositionManager = (await ethers.getContractFactory(
    "PositionManager",
    (
      await ethers.getSigners()
    )[0]
  )) as PositionManager__factory
  const positionManager = await upgrades.deployProxy(PositionManager, [BOOK_KEEPER_ADDR, SHOW_STOPPER_ADDR])
  await positionManager.deployed()
  console.log(`>> Deployed at ${positionManager.address}`)
}

export default func
func.tags = ["PositionManager"]
