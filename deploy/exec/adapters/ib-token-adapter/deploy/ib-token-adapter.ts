import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { IbTokenAdapter__factory } from "../../../../../typechain"
import { ConfigEntity } from "../../../../entities"
import { formatBytes32String } from "ethers/lib/utils"
import { BigNumber } from "ethers"

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

  const COLLATERAL_POOL_ID = formatBytes32String("ibUSDT")
  const COLLATERAL_TOKEN_ADDR = "0x158Da805682BdC8ee32d52833aD41E74bb951E59" // ibUSDT
  const REWARD_TOKEN_ADDR = "0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F" // ALPACA
  const FAIR_LAUNCH_ADDR = "0xA625AB01B08ce023B2a342Dbb12a16f2C8489A8F"
  const PID = 16
  const SHIELD_ADDR = "0x1963f84395C8cf464E5483dE7f2f434c3F1b4656"
  const TIME_LOCK_ADDR = "0x2D5408f2287BF9F9B05404794459a846651D0a59"
  const TREASURY_FEE_BPS = BigNumber.from(900) // 9%
  const TREASURY_ACCOUNT = "0x7E2308437c2f4C8934214663dc8476037625a270"

  const config = ConfigEntity.getConfig()

  console.log(">> Deploying an upgradable IbTokenAdapter contract")
  const IbTokenAdapter = (await ethers.getContractFactory(
    "IbTokenAdapter",
    (
      await ethers.getSigners()
    )[0]
  )) as IbTokenAdapter__factory
  const ibTokenAdapter = await upgrades.deployProxy(IbTokenAdapter, [
    config.BookKeeper.address,
    COLLATERAL_POOL_ID,
    COLLATERAL_TOKEN_ADDR,
    REWARD_TOKEN_ADDR,
    FAIR_LAUNCH_ADDR,
    PID,
    SHIELD_ADDR,
    TIME_LOCK_ADDR,
    TREASURY_FEE_BPS,
    TREASURY_ACCOUNT,
    config.PositionManager.address,
  ])
  await ibTokenAdapter.deployed()
  console.log(`>> Deployed at ${ibTokenAdapter.address}`)
  const tx = await ibTokenAdapter.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["IbTokenAdapter"]
