import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { CollateralPoolConfig__factory } from "../../../../typechain"
import { formatBytes32String, parseEther, parseUnits } from "ethers/lib/utils"
import { CollateralPool } from "../../../interfaces/config"
import { writeFileSync } from "fs"
import { BigNumber } from "@ethersproject/bignumber"

interface IPoolConfig {
  name: string
  debtCeilingValue: BigNumber
}

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

  const COLLATERAL_POOS_CONFIG: IPoolConfig[] = [
    {
      name: "ibBUSD",
      debtCeilingValue: parseUnits("2250000", 45),
    },
    {
      name: "ibUSDT",
      debtCeilingValue: parseUnits("1000000", 45),
    },
    {
      name: "ibWBNB",
      debtCeilingValue: parseUnits("1000000", 45),
    },
  ]

  const deployer = (await ethers.getSigners())[0]

  const collateralPoolConfig = CollateralPoolConfig__factory.connect(config.CollateralPoolConfig.address, deployer)

  console.log(`>> setDebtCeiling`)
  for (const poolConfig of COLLATERAL_POOS_CONFIG) {
    const poolIdx = config.CollateralPoolConfig.collateralPools.findIndex(
      (c: CollateralPool) => c.collateralPoolId === poolConfig.name
    )
    if (poolIdx === -1) {
      throw new Error(`Not found pool ${poolConfig.name}`)
    }

    const poolId = formatBytes32String(poolConfig.name)
    const tx = await collateralPoolConfig.setDebtCeiling(poolId, poolConfig.debtCeilingValue, {
      gasPrice: ethers.utils.parseUnits("30", "gwei"),
    })
    await tx.wait()
    console.log(`name : ${poolConfig.name} value : ${poolConfig.debtCeilingValue} tx hash: ${tx.hash}`)

    config.CollateralPoolConfig.collateralPools[poolIdx] = {
      ...config.CollateralPoolConfig.collateralPools[poolIdx],
      debtCeiling: poolConfig.debtCeilingValue.toString(),
    }
  }
  const fileName = ".mainnet.json"
  console.log(`>> Update ${fileName} File`)
  writeFileSync(fileName, JSON.stringify(config, null, 2))
}

export default func
func.tags = ["SetDebtCeiling"]
