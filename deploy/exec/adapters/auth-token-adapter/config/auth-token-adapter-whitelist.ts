import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../../entities"
import { AuthTokenAdapter__factory } from "../../../../../typechain"

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

  const STABLE_SWAP_MODULE_ADDR = config.StableSwapModule.address
  const AUTH_TOKEN_ADAPTER_ADDR = config.AuthTokenAdapters[0].address

  const authTokenAdapter = AuthTokenAdapter__factory.connect(AUTH_TOKEN_ADAPTER_ADDR, (await ethers.getSigners())[0])
  console.log(`>> AuthTokenAdapter whitelist address: ${STABLE_SWAP_MODULE_ADDR}`)
  const tx = await authTokenAdapter.grantRole(await authTokenAdapter.WHITELISTED(), STABLE_SWAP_MODULE_ADDR)
  await tx.wait()
  console.log(`tx hash: ${tx.hash}`)
  console.log("✅ Done")
}

export default func
func.tags = ["AuthTokenAdapterWhitelist"]
