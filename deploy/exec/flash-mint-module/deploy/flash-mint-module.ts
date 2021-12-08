import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { FlashMintModule__factory } from "../../../../typechain"
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

  const STABLE_COIN_ADAPTER_ADDR = config.StablecoinAdapters.AUSD.address
  const SYSTEM_DEBT_ENGINE_ADDR = config.SystemDebtEngine.address

  console.log(">> Deploying an upgradable FlashMintModule contract")
  const FlashMintModule = (await ethers.getContractFactory(
    "FlashMintModule",
    (
      await ethers.getSigners()
    )[0]
  )) as FlashMintModule__factory
  const flashMintModule = await upgrades.deployProxy(FlashMintModule, [
    STABLE_COIN_ADAPTER_ADDR,
    SYSTEM_DEBT_ENGINE_ADDR,
  ])
  await flashMintModule.deployed()
  console.log(`>> Deployed at ${flashMintModule.address}`)
  const tx = await flashMintModule.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["FlashMintModule"]
