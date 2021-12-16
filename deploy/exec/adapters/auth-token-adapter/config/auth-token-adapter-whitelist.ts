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

  const STABLE_SWAP_MODULE_ADDR = "0x4DFc61A2A781A40e4a23AbeB4CbdF1dCAf23Ce3c"
  const AUTH_TOKEN_ADAPTER_ADDR = "0x7df2012A6D89c48B111f9535E84b4906f726d54f"

  const authTokenAdapter = AuthTokenAdapter__factory.connect(AUTH_TOKEN_ADAPTER_ADDR, (await ethers.getSigners())[0])
  console.log(`>> AuthTokenAdapter whitelist address: ${STABLE_SWAP_MODULE_ADDR}`)
  const tx = await authTokenAdapter.grantRole(await authTokenAdapter.WHITELISTED(), STABLE_SWAP_MODULE_ADDR)
  await tx.wait()
  console.log(`tx hash: ${tx.hash}`)
  console.log("✅ Done")
}

export default func
func.tags = ["AuthTokenAdapterWhitelist"]
