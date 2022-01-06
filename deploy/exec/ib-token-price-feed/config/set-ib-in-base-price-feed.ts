import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers } from "hardhat"
import { IbTokenPriceFeed__factory, VaultPriceOracle__factory } from "../../../../typechain"
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

  const NEW_IB_IN_BASE_PRICE_FEED = ""

  const ibTokenPriceFeed = IbTokenPriceFeed__factory.connect(
    config.PriceFeed.IbTokenPriceFeed.filter((o) => o.name === IB_TOKEN_PRICE_FEED)[0].address,
    (await ethers.getSigners())[0]
  )
  console.log(`>> ${IB_TOKEN_PRICE_FEED} ibTokenPriceFeed set IbInBasePriceFeed: ${NEW_IB_IN_BASE_PRICE_FEED}`)
  await ibTokenPriceFeed.setIbInBasePriceFeed(NEW_IB_IN_BASE_PRICE_FEED)
  console.log("✅ Done")
}

export default func
func.tags = ["SetIbInBasePriceFeed"]
