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

  const ALPACA_ORACLE = "0x166f56F2EDa9817cAB77118AE4FCAA0002A17eC7" // Alpaca LYF's SimplePriceOracle
  const TOKEN_0 = "0x7C9e73d4C71dae564d41F78d56439bB4ba87592f" // ibBUSD
  const TOKEN_1 = "0xe9e7cea3dedca5984780bafc599bd69add087d56" // BUSD

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
  const tx = await alpacaOraclePriceFeed.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["AlpacaOraclePriceFeed"]
