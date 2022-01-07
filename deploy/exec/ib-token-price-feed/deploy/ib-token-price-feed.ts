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

  const IB_IN_BASE_PRICE_FEED_ADDR = "0x437bFac2Ab6C24f27Dd34f6da318aC721632f342" // ibWBNB/WBNB StrictAlpacaOraclePriceFeed address
  const BASE_IN_USD_PRICE_FEED_ADDR = "0x97EDd2Dc6867514884E2DDe3eCDC563Fea91eB95" // WBNB/USD StrictAlpacaOraclePriceFeed address
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
