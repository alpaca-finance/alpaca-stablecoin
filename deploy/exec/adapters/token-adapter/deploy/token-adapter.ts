import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { TokenAdapter__factory } from "../../../../../typechain"

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

  console.log(">> Deploying an upgradable TokenAdapter contract")
  const TokenAdapter = (await ethers.getContractFactory(
    "TokenAdapter",
    (
      await ethers.getSigners()
    )[0]
  )) as TokenAdapter__factory
  const tokenAdapter = await upgrades.deployProxy(TokenAdapter, [
    BOOK_KEEPER_ADDR,
    COLLATERAL_POOL_ID,
    COLLATERAL_TOKEN_ADDR,
  ])
  await tokenAdapter.deployed()
  console.log(`>> Deployed at ${tokenAdapter.address}`)
}

export default func
func.tags = ["TokenAdapter"]
