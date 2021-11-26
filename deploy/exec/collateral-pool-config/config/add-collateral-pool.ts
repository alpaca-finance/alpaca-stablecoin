import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { CollateralPoolConfig__factory } from "../../../../typechain"
import { BigNumber } from "ethers"
import { formatBytes32String } from "ethers/lib/utils"
import { WeiPerRad, WeiPerRay } from "../../../../test/helper/unit"

interface IAddCollateralPoolParam {
  COLLATERAL_POOL_ID: string
  DEBT_CEILING: BigNumber // [RAD]
  DEBT_FLOOR: BigNumber // [RAD]
  PRICE_FEED: string
  LIQUIDATION_RATIO: BigNumber // [RAY]
  STABILITY_FEE_RATE: BigNumber // [RAY]
  ADAPTER: string
  CLOSE_FACTOR_BPS: BigNumber
  LIQUIDATOR_INCENTIVE_BPS: BigNumber
  TREASURY_FEES_BPS: BigNumber
  STRATEGY: string
}

type IAddCollateralPoolParamList = Array<IAddCollateralPoolParam>

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

  const COLLATERAL_POOLS: IAddCollateralPoolParamList = [
    // {
    //   COLLATERAL_POOL_ID: "ibBUSD",
    //   DEBT_CEILING: WeiPerRad.mul(1000),
    //   DEBT_FLOOR: WeiPerRad.mul(1),
    //   PRICE_FEED: "0xf8210Fd8a21752aEa1FeE8F64c2BBaf9e304A37a",
    //   LIQUIDATION_RATIO: WeiPerRay,
    //   STABILITY_FEE_RATE: WeiPerRay,
    //   ADAPTER: "0xF4ecba29De9Cb7c127E2fB870d560B35CEC73A5c",
    //   CLOSE_FACTOR_BPS: BigNumber.from(5000),
    //   LIQUIDATOR_INCENTIVE_BPS: BigNumber.from(10250),
    //   TREASURY_FEES_BPS: BigNumber.from(5000),
    //   STRATEGY: "0x4E4d4775889f25f3CdCa0fA4917D8C7907289049",
    // },
    {
      COLLATERAL_POOL_ID: "ibWBNB",
      DEBT_CEILING: WeiPerRad.mul(10000000),
      DEBT_FLOOR: WeiPerRad.mul(1),
      PRICE_FEED: "0xc8fa978b427F39a8d06cc705C1be2f32A1573D56",
      LIQUIDATION_RATIO: WeiPerRay,
      STABILITY_FEE_RATE: WeiPerRay,
      ADAPTER: "0x3E1d93514d0e346959E7cB63b34dcEB170EFd204",
      CLOSE_FACTOR_BPS: BigNumber.from(5000),
      LIQUIDATOR_INCENTIVE_BPS: BigNumber.from(10250),
      TREASURY_FEES_BPS: BigNumber.from(5000),
      STRATEGY: "0x4E4d4775889f25f3CdCa0fA4917D8C7907289049",
    },
  ]

  const config = ConfigEntity.getConfig()

  const collateralPoolConfig = CollateralPoolConfig__factory.connect(
    config.CollateralPoolConfig.address,
    (await ethers.getSigners())[0]
  )
  for (let i = 0; i < COLLATERAL_POOLS.length; i++) {
    const collateralPool = COLLATERAL_POOLS[i]
    console.log(`>> add CollateralPool ID: ${collateralPool.COLLATERAL_POOL_ID}`)
    await collateralPoolConfig.initCollateralPool(
      formatBytes32String(collateralPool.COLLATERAL_POOL_ID),
      collateralPool.DEBT_CEILING,
      collateralPool.DEBT_FLOOR,
      collateralPool.PRICE_FEED,
      collateralPool.LIQUIDATION_RATIO,
      collateralPool.STABILITY_FEE_RATE,
      collateralPool.ADAPTER,
      collateralPool.CLOSE_FACTOR_BPS,
      collateralPool.LIQUIDATOR_INCENTIVE_BPS,
      collateralPool.TREASURY_FEES_BPS,
      collateralPool.STRATEGY
    )
    console.log(`✅ Done Pool ID: ${collateralPool.COLLATERAL_POOL_ID}`)
  }
}

export default func
func.tags = ["AddCollateralPool"]
