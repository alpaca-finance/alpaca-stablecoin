import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { StableSwapModule__factory } from "../../../../typechain"
import { ConfigEntity } from "../../../entities"

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

  const AUTH_TOKEN_ADAPTER_ADDR = ""
  const STABLECOIN_ADAPTER_ADDR = config.StablecoinAdapters.AUSD.address
  const SYSTEM_DEBT_ENGINE_ADDR = config.SystemDebtEngine.address

  console.log(">> Deploying an upgradable StableSwapModule contract")
  const StableSwapModule = (await ethers.getContractFactory(
    "StableSwapModule",
    (
      await ethers.getSigners()
    )[0]
  )) as StableSwapModule__factory
  const stableSwapModule = await upgrades.deployProxy(StableSwapModule, [
    AUTH_TOKEN_ADAPTER_ADDR,
    STABLECOIN_ADAPTER_ADDR,
    SYSTEM_DEBT_ENGINE_ADDR,
  ])
  await stableSwapModule.deployed()
  console.log(`>> Deployed at ${stableSwapModule.address}`)
  const tx = await stableSwapModule.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["DeployStableSwapModule"]
