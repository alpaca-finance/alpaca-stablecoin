import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { AlpacaStablecoin__factory } from "../../../../typechain"

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

  const ALPACA_STABLECOIN_ADDR = config.AlpacaStablecoin.AUSD.address
  const STABLECOIN_ADAPTER_ADDR = config.StablecoinAdapters.AUSD.address

  const alpacaStablecoin = AlpacaStablecoin__factory.connect(ALPACA_STABLECOIN_ADDR, (await ethers.getSigners())[0])
  console.log(`>> Grant MINTER_ROLE address: ${STABLECOIN_ADAPTER_ADDR}`)
  await alpacaStablecoin.grantRole(await alpacaStablecoin.MINTER_ROLE(), STABLECOIN_ADAPTER_ADDR)
  console.log("✅ Done")
}

export default func
func.tags = ["GrantMinterRole"]
