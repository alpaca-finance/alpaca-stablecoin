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

  // Collateral Factor for ibBUSD = 90% = 0.90
  // Liquidation Ratio = 1 / 0.90 = 1111111111111111111111111111
  const NEW_LIQUIDATION_RATIO = ethers.utils
    .parseUnits("1", 27)
    .mul(ethers.utils.parseUnits("1", 27))
    .div(ethers.utils.parseUnits("0.90", 27))
  const COLLATERAL_POOL_ID = formatBytes32String("ibBUSD")

  const collateralPoolConfig = CollateralPoolConfig__factory.connect(
    config.CollateralPoolConfig.address,
    (await ethers.getSigners())[0]
  )
  console.log(`>> setLiquidationRatio to ${NEW_LIQUIDATION_RATIO}`)
  const tx = await collateralPoolConfig.setLiquidationRatio(COLLATERAL_POOL_ID, NEW_LIQUIDATION_RATIO, {
    gasLimit: 1000000,
  })
  await tx.wait()
  console.log(`tx hash: ${tx.hash}`)
}

export default func
func.tags = ["SetLiquidationRatio"]
