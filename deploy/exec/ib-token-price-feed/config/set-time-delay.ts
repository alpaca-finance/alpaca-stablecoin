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
  const NEW_TIME_DELAY = 900 // 15 minutes

  const ibTokenPriceFeed = config.PriceFeed.IbTokenPriceFeed.find((o) => o.name === IB_TOKEN_PRICE_FEED)
  if (!ibTokenPriceFeed) throw new Error(`error: unable to map ${IB_TOKEN_PRICE_FEED} to any IbTokenPriceFeed`)
  const ibTokenPriceFeedContract = IbTokenPriceFeed__factory.connect(
    ibTokenPriceFeed.address,
    (await ethers.getSigners())[0]
  )
  console.log(`>> ${IB_TOKEN_PRICE_FEED} ibTokenPriceFeed set time delay: ${NEW_TIME_DELAY}`)
  await ibTokenPriceFeedContract.setTimeDelay(NEW_TIME_DELAY)
  console.log("✅ Done")
}

export default func
func.tags = ["SetTimeDelay"]
