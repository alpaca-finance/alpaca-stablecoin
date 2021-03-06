import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { StrictAlpacaOraclePriceFeed__factory } from "../../../../typechain"
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

  const PRIMARY_ALPACA_ORACLE = config.Oracle.SimpleOracle.address // SimplePriceOracle
  const PRIMARY_TOKEN_0 = "0x7C9e73d4C71dae564d41F78d56439bB4ba87592f" // ibBUSD
  const PRIMARY_TOKEN_1 = "0xe9e7cea3dedca5984780bafc599bd69add087d56" // BUSD
  const SECONDARY_ALPACA_ORACLE = config.Oracle.VaultPriceOracle.address // VaultPriceOracle
  const SECONDARY_TOKEN_0 = "0x7C9e73d4C71dae564d41F78d56439bB4ba87592f" // ibBUSD
  const SECONDARY_TOKEN_1 = "0xe9e7cea3dedca5984780bafc599bd69add087d56" // BUSD
  const ACCESS_CONTROL_CONFIG = config.AccessControlConfig.address

  console.log(">> Deploying an upgradable StrictAlpacaOraclePriceFeed contract")
  const StrictAlpacaOraclePriceFeed = (await ethers.getContractFactory(
    "StrictAlpacaOraclePriceFeed",
    (
      await ethers.getSigners()
    )[0]
  )) as StrictAlpacaOraclePriceFeed__factory
  const strictAlpacaOraclePriceFeed = await upgrades.deployProxy(StrictAlpacaOraclePriceFeed, [
    PRIMARY_ALPACA_ORACLE,
    PRIMARY_TOKEN_0,
    PRIMARY_TOKEN_1,
    SECONDARY_ALPACA_ORACLE,
    SECONDARY_TOKEN_0,
    SECONDARY_TOKEN_1,
    ACCESS_CONTROL_CONFIG,
  ])
  await strictAlpacaOraclePriceFeed.deployed()
  console.log(`>> Deployed at ${strictAlpacaOraclePriceFeed.address}`)
  const tx = await strictAlpacaOraclePriceFeed.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["StrictAlpacaOraclePriceFeed"]
