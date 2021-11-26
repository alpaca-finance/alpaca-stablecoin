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

  const ALPACA_ORACLE = "0xFb0645d38e35DA4C4Aa0079366B7d9905f162fCe" // Alpaca LYF's SimplePriceOracle
  const TOKEN_0 = "0xe5ed8148fE4915cE857FC648b9BdEF8Bb9491Fa5" // ibBUSD
  const TOKEN_1 = "0x0266693F9Df932aD7dA8a9b44C2129Ce8a87E81f" // BUSD

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
