import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { StableSwapModule__factory } from "../../../../typechain"
import { getDeployer } from "../../../services/deployer-helper"

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

  const FEE_OUT = 0

  const config = ConfigEntity.getConfig()
  const deployer = await getDeployer()

  const stableSwapModule = StableSwapModule__factory.connect(
    config.StableSwapModule.address,
    deployer
  )

  console.log(`>> setFeeOut to ${FEE_OUT}`)
  const tx = await stableSwapModule.setFeeOut(FEE_OUT)
  await tx.wait()
  console.log(`tx hash: ${tx.hash}`)
  console.log("✅ Done")
}

export default func
func.tags = ["SetFeeOut"]
