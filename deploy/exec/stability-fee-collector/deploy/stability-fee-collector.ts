import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { StabilityFeeCollector__factory } from "../../../../typechain"

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

  console.log(">> Deploying an upgradable StabilityFeeCollector contract")
  const StabilityFeeCollector = (await ethers.getContractFactory(
    "StabilityFeeCollector",
    (
      await ethers.getSigners()
    )[0]
  )) as StabilityFeeCollector__factory
  const stabilityFeeCollector = await upgrades.deployProxy(StabilityFeeCollector, [BOOK_KEEPER_ADDR])
  await stabilityFeeCollector.deployed()
  console.log(`>> Deployed at ${stabilityFeeCollector.address}`)
}

export default func
func.tags = ["StabilityFeeCollector"]