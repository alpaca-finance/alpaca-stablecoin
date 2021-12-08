import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { StaticPriceFeed__factory } from "../../../../typechain"
import { WeiPerRad } from "../../../../test/helper/unit"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const RAD = 45
  /*
  ░██╗░░░░░░░██╗░█████╗░██████╗░███╗░░██╗██╗███╗░░██╗░██████╗░
  ░██║░░██╗░░██║██╔══██╗██╔══██╗████╗░██║██║████╗░██║██╔════╝░
  ░╚██╗████╗██╔╝███████║██████╔╝██╔██╗██║██║██╔██╗██║██║░░██╗░
  ░░████╔═████║░██╔══██║██╔══██╗██║╚████║██║██║╚████║██║░░╚██╗
  ░░╚██╔╝░╚██╔╝░██║░░██║██║░░██║██║░╚███║██║██║░╚███║╚██████╔╝
  ░░░╚═╝░░░╚═╝░░╚═╝░░╚═╝╚═╝░░╚═╝╚═╝░░╚══╝╚═╝╚═╝░░╚══╝░╚═════╝░
  Check all variables below before execute the deployment script
  */

  const PRICE_IN_WAD = ethers.utils.parseUnits("1", 18) // [WAD]
  const STATIC_PRICE_FEED_ADDR = ""

  const config = ConfigEntity.getConfig()

  const staticPriceFeed = StaticPriceFeed__factory.connect(STATIC_PRICE_FEED_ADDR, (await ethers.getSigners())[0])

  console.log(">> setPrice")
  await staticPriceFeed.setPrice(PRICE_IN_WAD, { gasLimit: 1000000 })
  console.log("✅ Done")
}

export default func
func.tags = ["SetPriceStatic"]
