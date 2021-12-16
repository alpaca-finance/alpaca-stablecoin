import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { CollateralPoolConfig__factory } from "../../../../typechain"
import { BigNumber } from "ethers"
import { formatBytes32String } from "ethers/lib/utils"
import { WeiPerRad, WeiPerRay } from "../../../../test/helper/unit"

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

  const NEW_CLOSE_FACTOR_BPS = "2500" // 25% or 2500/10000 [bps]
  const COLLATERAL_POOL_ID = formatBytes32String("ibBUSD")

  const collateralPoolConfig = CollateralPoolConfig__factory.connect(
    config.CollateralPoolConfig.address,
    (await ethers.getSigners())[0]
  )
  console.log(`>> setCloseFactorBps to ${NEW_CLOSE_FACTOR_BPS}`)
  const tx = await collateralPoolConfig.setCloseFactorBps(COLLATERAL_POOL_ID, NEW_CLOSE_FACTOR_BPS, {
    gasPrice: ethers.utils.parseUnits("30", "gwei"),
  })
  await tx.wait()
  console.log(`tx hash: ${tx.hash}`)
}

export default func
func.tags = ["SetCloseFactorBps"]
