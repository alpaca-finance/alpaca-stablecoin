import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { CollateralPoolConfig__factory } from "../../../../typechain"
import { BigNumber } from "ethers"
import { formatBytes32String } from "ethers/lib/utils"
import { WeiPerRad, WeiPerRay } from "../../../../test/helper/unit"
import { AddressZero } from "../../../../test/helper/address"

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
    {
      COLLATERAL_POOL_ID: "ibUSDT",
      DEBT_CEILING: ethers.utils.parseUnits("30000000", 45), // 30M [rad]
      DEBT_FLOOR: ethers.utils.parseUnits("500", 45), // 500 AUSD [rad]
      PRICE_FEED: "0x7171041c054238c428fca8BC841B2582CDe58d10", // ibUSDT IbTokenPriceFeed
      // Collateral Factor for ibUSDT = 90% = 0.90
      // Liquidation Ratio = 1 / 0.90
      LIQUIDATION_RATIO: ethers.utils
        .parseUnits("1", 27)
        .mul(ethers.utils.parseUnits("1", 27))
        .div(ethers.utils.parseUnits("0.90", 27)),
      // Stability Fee Rate for ibUSDT = 2% = 1.02
      // Stability Fee Rate to be set = 1000000000627937192491029810
      // Ref: https://www.wolframalpha.com/input/?i=sqrt%281.02%2C+31536000%29
      STABILITY_FEE_RATE: BigNumber.from("1000000000627937192491029810"),
      ADAPTER: "0x2d764397908566c09E08f200DB6839bB791239f3", // ibUSDT IbTokenAdapter
      CLOSE_FACTOR_BPS: BigNumber.from(2500), // 25% Close Factor
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
    const tx = await collateralPoolConfig.initCollateralPool(
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
      collateralPool.STRATEGY,
      { gasLimit: 1500000 }
    )
    console.log(`tx: ${tx.hash}`)
    console.log(`✅ Done Pool ID: ${collateralPool.COLLATERAL_POOL_ID}`)
  }
}

export default func
func.tags = ["AddCollateralPool"]
