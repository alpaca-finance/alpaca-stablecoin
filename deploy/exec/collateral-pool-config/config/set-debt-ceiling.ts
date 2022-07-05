import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { CollateralPoolConfig__factory } from "../../../../typechain"
import { formatBytes32String } from "ethers/lib/utils"
import { CollateralPool } from "../../../interfaces/config"
import { writeFileSync } from "fs"

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

  let config = ConfigEntity.getConfig()

  const COLLATERAL_POOL_NAMES = ["ibBUSD", "ibUSDT", "ibWBNB"]
  const DEBT_CEILING_VALUE = 0

  const deployer = (await ethers.getSigners())[0]

  const collateralPoolConfig = CollateralPoolConfig__factory.connect(config.CollateralPoolConfig.address, deployer)

  console.log(`>> setDebtCeiling`)
  for (const name of COLLATERAL_POOL_NAMES) {
    const poolIdx = config.CollateralPoolConfig.collateralPools.findIndex(
      (c: CollateralPool) => c.collateralPoolId === name
    )
    if (poolIdx === -1) {
      throw new Error(`Not found pool ${name}`)
    }

    const poolId = formatBytes32String(name)
    const tx = await collateralPoolConfig.setDebtCeiling(poolId, DEBT_CEILING_VALUE, {
      gasPrice: ethers.utils.parseUnits("30", "gwei"),
    })
    await tx.wait()
    console.log(`name : ${name} tx hash: ${tx.hash}`)

    config.CollateralPoolConfig.collateralPools[poolIdx] = {
      ...config.CollateralPoolConfig.collateralPools[poolIdx],
      debtCeiling: DEBT_CEILING_VALUE.toString(),
    }
  }
  const fileName = ".mainnet.json"
  console.log(`>> Update ${fileName} File`)
  writeFileSync(fileName, JSON.stringify(config))
}

export default func
func.tags = ["SetDebtCeiling"]
