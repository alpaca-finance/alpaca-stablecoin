import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { IbTokenPriceFeed__factory } from "../../../../typechain"
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

  const IB_IN_BASE_PRICE_FEED_ADDR = "0x8CC012356E61424446646ec3B261fe5EF5B44A8a" // AlpacaOraclePriceFeed dddress from 016
  const BASE_IN_USD_PRICE_FEED_ADDR = "0x9F748f798C75EA44F86a5871045629a2aC9C0568" // StrictAlpacaOraclePriceFeed address from 018

  const config = ConfigEntity.getConfig()

  console.log(">> Deploying an upgradable IbTokenPriceFeed contract")
  const IbTokenPriceFeed = (await ethers.getContractFactory(
    "IbTokenPriceFeed",
    (
      await ethers.getSigners()
    )[0]
  )) as IbTokenPriceFeed__factory
  const ibTokenPriceFeed = await upgrades.deployProxy(IbTokenPriceFeed, [
    IB_IN_BASE_PRICE_FEED_ADDR,
    BASE_IN_USD_PRICE_FEED_ADDR,
    config.AccessControlConfig.address,
  ])
  await ibTokenPriceFeed.deployed()
  console.log(`>> Deployed at ${ibTokenPriceFeed.address}`)
  const tx = await ibTokenPriceFeed.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["IbTokenPriceFeed"]
