import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { StrictAlpacaOraclePriceFeed__factory } from "../../../../typechain"
import { ConfigEntity } from "../../../entities"
import { Timelock__factory } from "@alpaca-finance/alpaca-contract/typechain"

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
  const ETA = "1638255900"

  const config = ConfigEntity.getConfig()
  const deployer = (await ethers.getSigners())[0]
  console.log(">> Prepare upgrade StrictAlpacaOraclePriceFeed contract")
  const StrictAlpacaOraclePriceFeed = (await ethers.getContractFactory(
    "StrictAlpacaOraclePriceFeed",
    deployer
  )) as StrictAlpacaOraclePriceFeed__factory
  const strictAlpacaOraclePriceFeed = await upgrades.prepareUpgrade(ADDR, StrictAlpacaOraclePriceFeed)
  console.log(`>> Upgrade at ${strictAlpacaOraclePriceFeed}`)

  const timelock = Timelock__factory.connect(config.Timelock, deployer)
  await timelock.queueTransaction(
    config.ProxyAdmin,
    0,
    "upgrade(address,address)",
    ethers.utils.defaultAbiCoder.encode(["address", "address"], [ADDR, strictAlpacaOraclePriceFeed]),
    ETA
  )

  console.log(">> Timelock execution tx:")
  console.log(
    `await timelock.executeTransaction('${
      config.ProxyAdmin
    }', 0, "upgrade(address,address)", '${ethers.utils.defaultAbiCoder.encode(
      ["address", "address"],
      [ADDR, strictAlpacaOraclePriceFeed]
    )}', "${ETA}")`
  )
}

export default func
func.tags = ["UpgradeStrictAlpacaOraclePriceFeed"]
