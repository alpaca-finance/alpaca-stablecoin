import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { StableSwapModule__factory } from "../../../../typechain"

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

  const FEE_OUT = ethers.utils.parseUnits("0.002", 18).toString() // [wad = 100%]

  const config = ConfigEntity.getConfig()

  const stableSwapModule = StableSwapModule__factory.connect(
    config.StableSwapModule.address,
    (await ethers.getSigners())[0]
  )

  console.log(`>> setFeeOut to ${FEE_OUT}`)
  const tx = await stableSwapModule.setFeeOut(FEE_OUT)
  await tx.wait()
  console.log(`tx hash: ${tx.hash}`)
  console.log("✅ Done")
}

export default func
func.tags = ["SetFeeOut"]
