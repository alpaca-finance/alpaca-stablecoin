import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { PCSFlashLiquidator__factory } from "../../../../typechain"

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

  const FLASH_LIQUIDATOR_ADDR = config.FlashLiquidator.PCSFlashLiquidator.address
  const TO_BE_WHITELISTED_ADDR = config.StablecoinAdapters.AUSD.address

  const pcsFlashLiquidator = PCSFlashLiquidator__factory.connect(FLASH_LIQUIDATOR_ADDR, (await ethers.getSigners())[0])
  console.log(`>> Flash Liquidator whitelist address: ${TO_BE_WHITELISTED_ADDR}`)
  await pcsFlashLiquidator.whitelist(TO_BE_WHITELISTED_ADDR)
  console.log("✅ Done")
}

export default func
func.tags = ["PCSFlashLiquidatorWhitelist"]
