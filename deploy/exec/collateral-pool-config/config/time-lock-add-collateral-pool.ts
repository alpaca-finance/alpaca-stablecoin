import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity, TimelockEntity } from "../../../entities"
import { FileService, TimelockService } from "../../../services"
import { BigNumber } from "ethers"
import { formatBytes32String } from "ethers/lib/utils"

interface IAddCollateralPoolParam {
  COLLATERAL_POOL_ID: string
  DEBT_CEILING: BigNumber // [RAD]
  DEBT_FLOOR: BigNumber // [RAD]
  PRICE_FEED: string
  LIQUIDATION_RATIO: BigNumber // [RAY]
  STABILITY_FEE_RATE: BigNumber // [RAY]
  ADAPTER: string
  CLOSE_FACTOR_BPS: number
  LIQUIDATOR_INCENTIVE_BPS: number
  TREASURY_FEES_BPS: number
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
    {
      COLLATERAL_POOL_ID: formatBytes32String(""),
      DEBT_CEILING: BigNumber.from(0),
      DEBT_FLOOR: BigNumber.from(0),
      PRICE_FEED: "",
      LIQUIDATION_RATIO: BigNumber.from(0),
      STABILITY_FEE_RATE: BigNumber.from(0),
      ADAPTER: "",
      CLOSE_FACTOR_BPS: 0,
      LIQUIDATOR_INCENTIVE_BPS: 0,
      TREASURY_FEES_BPS: 0,
      STRATEGY: "",
    },
  ]

  const EXACT_ETA = "1631600100"

  const config = ConfigEntity.getConfig()
  const timelockTransactions: Array<TimelockEntity.Transaction> = []

  for (let i = 0; i < COLLATERAL_POOLS.length; i++) {
    const collateralPoolConfig = COLLATERAL_POOLS[i]
    timelockTransactions.push(
      await TimelockService.queueTransaction(
        `add collateral pool #${collateralPoolConfig.COLLATERAL_POOL_ID}`,
        config.CollateralPoolConfig.address,
        "0",
        "initCollateralPool(bytes32,uint256,uint256,address,uint256,uint256,address,uint256,uint256,uint256,address)",
        [
          "bytes32",
          "uint256",
          "uint256",
          "address",
          "uint256",
          "uint256",
          "address",
          "uint256",
          "uint256",
          "uint256",
          "address",
        ],
        [
          collateralPoolConfig.COLLATERAL_POOL_ID,
          collateralPoolConfig.DEBT_CEILING,
          collateralPoolConfig.DEBT_FLOOR,
          collateralPoolConfig.PRICE_FEED,
          collateralPoolConfig.LIQUIDATION_RATIO,
          collateralPoolConfig.STABILITY_FEE_RATE,
          collateralPoolConfig.ADAPTER,
          collateralPoolConfig.CLOSE_FACTOR_BPS,
          collateralPoolConfig.LIQUIDATOR_INCENTIVE_BPS,
          collateralPoolConfig.TREASURY_FEES_BPS,
          collateralPoolConfig.STRATEGY,
        ],
        EXACT_ETA
      )
    )
  }

  await FileService.write("add-collateral-pool", timelockTransactions)
}

export default func
func.tags = ["TimelockAddCollateralPools"]
