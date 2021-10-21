import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { AccessControlConfig__factory, AlpacaStablecoin__factory } from "../../../../typechain"

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

  const ALPACA_STABLECOIN_ADDR = "0x64c12ac760463FF3B6849FC1ab22Fe8D1c6e06de"
  const MINTER_ADDR = "0xea1FBaA5C061CF829Da88B3d711f7C2E4C09B9DC"

  const alpacaStablecoin = AlpacaStablecoin__factory.connect(ALPACA_STABLECOIN_ADDR, (await ethers.getSigners())[0])
  console.log(`>> Grant MINTER_ROLE address: ${MINTER_ADDR}`)
  await alpacaStablecoin.grantRole(await alpacaStablecoin.MINTER_ROLE(), MINTER_ADDR)
  console.log("✅ Done")
}

export default func
func.tags = ["GrantMinterRole"]
