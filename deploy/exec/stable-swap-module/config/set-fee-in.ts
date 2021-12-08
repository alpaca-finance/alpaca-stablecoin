import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { StableSwapModule__factory } from "../../../../typechain"
import { WeiPerRad } from "../../../../test/helper/unit"

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

  const FEE_IN = ethers.utils.parseUnits("0.002", 18).toString() // [RAD]

  const config = ConfigEntity.getConfig()

  const stableSwapModule = StableSwapModule__factory.connect(
    config.StableSwapModule.address,
    (await ethers.getSigners())[0]
  )

  console.log(`>> setFeeIn to ${FEE_IN}`)
  const tx = await stableSwapModule.setFeeIn(FEE_IN)
  await tx.wait()
  console.log(`tx hash: ${tx.hash}`)
  console.log("✅ Done")
}

export default func
func.tags = ["SetFeeIn"]
