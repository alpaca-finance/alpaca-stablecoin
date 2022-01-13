import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers } from "hardhat"
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

  const config = ConfigEntity.getConfig()

  const IB_TOKEN_PRICE_FEED = "ibBUSD-USD"
  const NEW_IB_IN_BASE_PRICE_FEED = "0xEA4e46420065C7Df0B931424A75C150474d72AC7"

  const ibTokenPriceFeed = config.PriceFeed.IbTokenPriceFeed.find((o) => o.name === IB_TOKEN_PRICE_FEED)
  if (!ibTokenPriceFeed) throw new Error(`error: unable to map ${IB_TOKEN_PRICE_FEED} to any IbTokenPriceFeed`)
  const ibTokenPriceFeedContract = IbTokenPriceFeed__factory.connect(
    ibTokenPriceFeed.address,
    (await ethers.getSigners())[0]
  )
  console.log(`>> ${IB_TOKEN_PRICE_FEED} ibTokenPriceFeed set IbInBasePriceFeed: ${NEW_IB_IN_BASE_PRICE_FEED}`)
  await ibTokenPriceFeedContract.setIbInBasePriceFeed(NEW_IB_IN_BASE_PRICE_FEED)
  console.log("✅ Done")
}

export default func
func.tags = ["SetIbInBasePriceFeed"]
