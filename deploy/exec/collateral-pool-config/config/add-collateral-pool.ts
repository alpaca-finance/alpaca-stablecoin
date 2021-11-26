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

  const config = ConfigEntity.getConfig()

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
      COLLATERAL_POOL_ID: "ibBUSD",
      DEBT_CEILING: ethers.utils.parseUnits("30000000", 45), // 30M [rad]
      DEBT_FLOOR: ethers.utils.parseUnits("100", 45), // 100 [rad]
      PRICE_FEED: "0xb5E89cf5A44752decBdEa3967736fA654A66E22A", // ibBUSD IbTokenPriceFeed
      // Collateral Factor for ibBUSD = 99% = 0.99
      // Liquidation Ratio = 1 / 0.99
      LIQUIDATION_RATIO: ethers.utils
        .parseUnits("1", 27)
        .mul(ethers.utils.parseUnits("1", 27))
        .div(ethers.utils.parseUnits("0.99", 27)),
      // Stability Fee Rate for ibBUSD = 2% = 1.02
      // Stability Fee Rate to be set = 1000000000627937192491029810
      // Ref: https://www.wolframalpha.com/input/?i=sqrt%281.02%2C+31536000%29
      STABILITY_FEE_RATE: BigNumber.from("1000000000627937192491029810"),
      ADAPTER: "0xdD3eEB2d0c9e26d6225f1f052FC7c504715Ca47D", // ibBUSD IbTokenAdapter
      CLOSE_FACTOR_BPS: BigNumber.from(5000), // 50% Close Factor
      LIQUIDATOR_INCENTIVE_BPS: BigNumber.from(10500), // 5% Liquidator Incentive
      TREASURY_FEES_BPS: BigNumber.from(8000), // 80% Treasury Fee
      STRATEGY: config.Strategies.FixedSpreadLiquidationStrategy.address, // FixedSpreadLiquidationStrategy
    },
  ]

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
