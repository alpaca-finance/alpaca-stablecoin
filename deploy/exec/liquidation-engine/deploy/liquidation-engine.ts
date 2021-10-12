import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { AlpacaStablecoin__factory, LiquidationEngine__factory } from "../../../../typechain"

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
  const SYSTEM_DEBT_ENGINE_ADDR = ""

  console.log(">> Deploying an upgradable LiquidationEngine contract")
  const LiquidationEngine = (await ethers.getContractFactory(
    "LiquidationEngine",
    (
      await ethers.getSigners()
    )[0]
  )) as LiquidationEngine__factory
  const liquidationEngine = await upgrades.deployProxy(LiquidationEngine, [BOOK_KEEPER_ADDR, SYSTEM_DEBT_ENGINE_ADDR])
  await liquidationEngine.deployed()
  console.log(`>> Deployed at ${liquidationEngine.address}`)
}

export default func
func.tags = ["LiquidationEngine"]
