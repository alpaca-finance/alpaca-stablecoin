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

  const config = ConfigEntity.getConfig()

  console.log(">> Deploying an upgradable StablecoinAdapter contract")
  const StablecoinAdapter = (await ethers.getContractFactory(
    "StablecoinAdapter",
    (
      await ethers.getSigners()
    )[0]
  )) as StablecoinAdapter__factory
  const stablecoinAdapter = await upgrades.deployProxy(StablecoinAdapter, [
    config.BookKeeper.address,
    config.AlpacaStablecoin.AUSD.address,
  ])
  await stablecoinAdapter.deployed()
  console.log(`>> Deployed at ${stablecoinAdapter.address}`)
  const tx = await stablecoinAdapter.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["StablecoinAdapter"]
