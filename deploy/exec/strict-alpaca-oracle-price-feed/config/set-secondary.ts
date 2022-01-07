import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { StrictAlpacaOraclePriceFeed__factory } from "../../../../typechain"

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

  const ADDR = "0xFe104175A2503248438d16C2425d6C2f3FAa5b65"
  const SECONDARY_ALPACA_ORACLE = config.Oracle.ChainLinkOracle.address // ChainLinkOracle
  const SECONDARY_TOKEN_0 = "0x0266693F9Df932aD7dA8a9b44C2129Ce8a87E81f" // BUSD
  const SECONDARY_TOKEN_1 = "0x115dffFFfffffffffFFFffffFFffFfFfFFFFfFff" // USD

  const strictAlpacaOraclePriceFeed = StrictAlpacaOraclePriceFeed__factory.connect(ADDR, (await ethers.getSigners())[0])

  console.log(">> setSecondary")
  await strictAlpacaOraclePriceFeed.setSecondary(SECONDARY_ALPACA_ORACLE, SECONDARY_TOKEN_0, SECONDARY_TOKEN_1)
  console.log("✅ Done")
}

export default func
func.tags = ["SetSecondary"]
