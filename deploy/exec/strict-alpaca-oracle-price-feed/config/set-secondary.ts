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

  const INPUT = [
    {
      ADDR: "0x9F748f798C75EA44F86a5871045629a2aC9C0568",
      SECONDARY_ALPACA_ORACLE: config.Oracle.ChainLinkOracle.address,
      SECONDARY_TOKEN_0: "0xe9e7cea3dedca5984780bafc599bd69add087d56",
      SECONDARY_TOKEN_1: "0x115dffFFfffffffffFFFffffFFffFfFfFFFFfFff",
    },
    {
      ADDR: "0x2B9C18a7e2F067E006E4625a74174472E9F89559",
      SECONDARY_ALPACA_ORACLE: config.Oracle.ChainLinkOracle.address,
      SECONDARY_TOKEN_0: "0x55d398326f99059ff775485246999027b3197955",
      SECONDARY_TOKEN_1: "0x115dffFFfffffffffFFFffffFFffFfFfFFFFfFff",
    },
    {
      ADDR: "0xdE375D37Be6399022D6583c954a011a9244a0b61",
      SECONDARY_ALPACA_ORACLE: config.Oracle.ChainLinkOracle.address,
      SECONDARY_TOKEN_0: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      SECONDARY_TOKEN_1: "0x115dffFFfffffffffFFFffffFFffFfFfFFFFfFff",
    },
  ]

  for (const item of INPUT) {
    const strictAlpacaOraclePriceFeed = StrictAlpacaOraclePriceFeed__factory.connect(
      item.ADDR,
      (await ethers.getSigners())[0]
    )

    console.log(">> setSecondary")
    await strictAlpacaOraclePriceFeed.setSecondary(
      item.SECONDARY_ALPACA_ORACLE,
      item.SECONDARY_TOKEN_0,
      item.SECONDARY_TOKEN_1
    )
    console.log("✅ Done")
  }
}

export default func
func.tags = ["SetSecondary"]
