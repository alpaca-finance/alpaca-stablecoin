import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { IbTokenAdapter__factory } from "../../../../../typechain"

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

  const BOOK_KEEPER_ADDR = ""
  const COLLATERAL_POOL_ID = ""
  const COLLATERAL_TOKEN_ADDR = ""
  const REWARD_TOKEN_ADDR = ""
  const FAIR_LAUNCH_ADDR = ""
  const PID = ""
  const SHIELD_ADDR = ""
  const TIME_LOCK_ADDR = ""
  const TREASURY_FEE_BPS = ""
  const TREASURY_ACCOUNT = ""
  const POSITION_MANAGER_ADDR = ""

  console.log(">> Deploying an upgradable IbTokenAdapter contract")
  const IbTokenAdapter = (await ethers.getContractFactory(
    "IbTokenAdapter",
    (
      await ethers.getSigners()
    )[0]
  )) as IbTokenAdapter__factory
  const ibTokenAdapter = await upgrades.deployProxy(IbTokenAdapter, [
    BOOK_KEEPER_ADDR,
    COLLATERAL_POOL_ID,
    COLLATERAL_TOKEN_ADDR,
    REWARD_TOKEN_ADDR,
    FAIR_LAUNCH_ADDR,
    PID,
    SHIELD_ADDR,
    TIME_LOCK_ADDR,
    TREASURY_FEE_BPS,
    TREASURY_ACCOUNT,
    POSITION_MANAGER_ADDR,
  ])
  await ibTokenAdapter.deployed()
  console.log(`>> Deployed at ${ibTokenAdapter.address}`)
}

export default func
func.tags = ["IbTokenAdapter"]
