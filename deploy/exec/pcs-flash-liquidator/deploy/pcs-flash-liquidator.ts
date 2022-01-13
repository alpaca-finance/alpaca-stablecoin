import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { PCSFlashLiquidator__factory } from "../../../../typechain"
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
  const wbnb = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
  const busd = "0xe9e7cea3dedca5984780bafc599bd69add087d56"

  console.log(">> Deploying an upgradable PCSFlashLiquidator contract")
  const PCSFlashLiquidator = (await ethers.getContractFactory(
    "PCSFlashLiquidator",
    (
      await ethers.getSigners()
    )[0]
  )) as PCSFlashLiquidator__factory
  const pcsFlashLiquidator = await upgrades.deployProxy(PCSFlashLiquidator, [
    config.BookKeeper.address,
    config.AlpacaStablecoin.AUSD.address,
    config.StablecoinAdapters.AUSD.address,
    wbnb,
    busd,
  ])
  await pcsFlashLiquidator.deployed()
  console.log(`>> Deployed at ${pcsFlashLiquidator.address}`)
  const tx = await pcsFlashLiquidator.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["PCSFlashLiquidator"]
