import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { StablecoinAdapter__factory } from "../../../../../typechain"
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

  const STABLECOIN_ADDR = "0x64c12ac760463FF3B6849FC1ab22Fe8D1c6e06de"

  const config = ConfigEntity.getConfig()

  console.log(">> Deploying an upgradable StablecoinAdapter contract")
  const StablecoinAdapter = (await ethers.getContractFactory(
    "StablecoinAdapter",
    (
      await ethers.getSigners()
    )[0]
  )) as StablecoinAdapter__factory
  const stablecoinAdapter = await upgrades.deployProxy(StablecoinAdapter, [config.BookKeeper.address, STABLECOIN_ADDR])
  await stablecoinAdapter.deployed()
  console.log(`>> Deployed at ${stablecoinAdapter.address}`)
}

export default func
func.tags = ["StablecoinAdapter"]
