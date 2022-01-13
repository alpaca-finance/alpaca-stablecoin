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

  const IB_IN_BASE_PRICE_FEED_ADDR = "0xF7E3B6C8AC5047c6aCf328C6c9c43EcDf15cD534"
  const BASE_IN_USD_PRICE_FEED_ADDR = "0xdE375D37Be6399022D6583c954a011a9244a0b61"
  const TIME_DELAY = 900

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
    TIME_DELAY,
  ])
  await ibTokenPriceFeed.deployed()
  console.log(`>> Deployed at ${ibTokenPriceFeed.address}`)
  const tx = await ibTokenPriceFeed.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["IbTokenPriceFeed"]
