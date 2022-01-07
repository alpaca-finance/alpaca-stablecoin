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
  const COLLATERAL_TOKEN_ADDR = "0xb5913CD4C508f07025678CeF939BcC54D3024C39" // ibUSDT
  const REWARD_TOKEN_ADDR = "0x354b3a11D5Ea2DA89405173977E271F58bE2897D" // ALPACA
  const FAIR_LAUNCH_ADDR = "0xac2fefDaF83285EA016BE3f5f1fb039eb800F43D"
  const PID = 15
  const SHIELD_ADDR = "0x938350DF8BF3bD81Baae368b72132f1Bd14E7C13"
  const TIME_LOCK_ADDR = "0xb3c3aE82358DF7fC0bd98629D5ed91767e45c337"
  const TREASURY_FEE_BPS = BigNumber.from(900) // 9%
  const TREASURY_ACCOUNT = "0xa96F122f567Df5f4A9978E1e5731acF2f2Fe2ab6"

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
