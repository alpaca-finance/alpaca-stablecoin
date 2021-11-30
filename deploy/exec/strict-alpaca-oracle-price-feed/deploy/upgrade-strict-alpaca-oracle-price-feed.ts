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

  const ADDR = "0xFe104175A2503248438d16C2425d6C2f3FAa5b65"

  const config = ConfigEntity.getConfig()

  console.log(">> Upgrading an upgradable StrictAlpacaOraclePriceFeed contract")
  const StrictAlpacaOraclePriceFeed = (await ethers.getContractFactory(
    "StrictAlpacaOraclePriceFeed",
    (
      await ethers.getSigners()
    )[0]
  )) as StrictAlpacaOraclePriceFeed__factory
  const strictAlpacaOraclePriceFeed = await upgrades.upgradeProxy(ADDR, StrictAlpacaOraclePriceFeed)
  await strictAlpacaOraclePriceFeed.deployed()
  console.log(`>> Upgrade at ${strictAlpacaOraclePriceFeed.address}`)
  const tx = await strictAlpacaOraclePriceFeed.deployTransaction.wait()
  console.log(`>> Upgrade block ${tx.blockNumber}`)
}

export default func
func.tags = ["UpgradeStrictAlpacaOraclePriceFeed"]
