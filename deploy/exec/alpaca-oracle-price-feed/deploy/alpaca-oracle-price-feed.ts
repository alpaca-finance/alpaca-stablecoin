import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { AlpacaOraclePriceFeed__factory } from "../../../../typechain"
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

  const ALPACA_ORACLE = ""
  const TOKEN_0 = ""
  const TOKEN_1 = ""

  const config = ConfigEntity.getConfig()

  console.log(">> Deploying an upgradable AlpacaOraclePriceFeed contract")
  const AlpacaOraclePriceFeed = (await ethers.getContractFactory(
    "AlpacaOraclePriceFeed",
    (
      await ethers.getSigners()
    )[0]
  )) as AlpacaOraclePriceFeed__factory
  const alpacaOraclePriceFeed = await upgrades.deployProxy(AlpacaOraclePriceFeed, [
    ALPACA_ORACLE,
    TOKEN_0,
    TOKEN_1,
    config.AccessControlConfig.address,
  ])
  await alpacaOraclePriceFeed.deployed()
  console.log(`>> Deployed at ${alpacaOraclePriceFeed.address}`)
}

export default func
func.tags = ["AlpacaOraclePriceFeed"]
