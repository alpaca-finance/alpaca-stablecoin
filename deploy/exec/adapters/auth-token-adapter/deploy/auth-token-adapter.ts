import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { AuthTokenAdapter__factory } from "../../../../../typechain"
import { ConfigEntity } from "../../../../entities"
import { formatBytes32String } from "@ethersproject/strings"

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
  const COLLATERAL_POOL_ID = formatBytes32String("BUSD-STABLE")
  const TOKEN_ADDR = "0x0266693F9Df932aD7dA8a9b44C2129Ce8a87E81f" // BUSD

  console.log(">> Deploying an upgradable AuthTokenAdapter contract")
  const AuthTokenAdapter = (await ethers.getContractFactory(
    "AuthTokenAdapter",
    (
      await ethers.getSigners()
    )[0]
  )) as AuthTokenAdapter__factory
  const authTokenAdapter = await upgrades.deployProxy(AuthTokenAdapter, [
    config.BookKeeper.address,
    COLLATERAL_POOL_ID,
    TOKEN_ADDR,
  ])
  await authTokenAdapter.deployed()
  console.log(`>> Deployed at ${authTokenAdapter.address}`)
  const tx = await authTokenAdapter.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["DeployAuthTokenAdapter"]
