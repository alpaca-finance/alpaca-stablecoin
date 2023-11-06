import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { BookKeeper__factory } from "../../../../typechain"
import { WeiPerRad } from "../../../../test/helper/unit"
import { getDeployer } from "../../../services/deployer-helper"

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

  const TOTAL_DEBT_CEILING = ethers.utils.parseUnits("0", RAD).toString() // [RAD]

  const config = ConfigEntity.getConfig()
  const deployer = await getDeployer()

  const bookKeeper = BookKeeper__factory.connect(config.BookKeeper.address, deployer)

  console.log(">> set TOTAL_DEBT_SHARE")
  await bookKeeper.setTotalDebtCeiling(TOTAL_DEBT_CEILING, { gasPrice: ethers.utils.parseUnits("8", "gwei")})
  console.log("✅ Done")
}

export default func
func.tags = ["SetTotalDebtCeiling"]
