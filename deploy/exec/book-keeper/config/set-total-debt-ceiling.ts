import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { BookKeeper__factory } from "../../../../typechain"
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

  // 30,000,000 AUSD Total Debt Ceiling
  const TOTAL_DEBT_CEILING = ethers.utils.parseUnits("30000000", RAD).toString() // [RAD]

  const config = ConfigEntity.getConfig()

  const bookKeeper = BookKeeper__factory.connect(config.BookKeeper.address, (await ethers.getSigners())[0])

  console.log(">> set TOTAL_DEBT_SHARE")
  await bookKeeper.setTotalDebtCeiling(TOTAL_DEBT_CEILING)
  console.log("✅ Done")
}

export default func
func.tags = ["SetTotalDebtCeiling"]
