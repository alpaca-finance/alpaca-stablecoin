import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers } from "hardhat"
import { VaultPriceOracle__factory } from "../../../../typechain"
import { ConfigEntity } from "../../../entities"

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

  const VAULT = "0xd7D069493685A581d27824Fc46EdA46B7EfC0063" // ibWBNB
  const IS_OK = true

  const config = ConfigEntity.getConfig()
  const vaultPriceOracle = VaultPriceOracle__factory.connect(
    config.Oracle.VaultPriceOracle.address,
    (await ethers.getSigners())[0]
  )
  console.log(`>> vaultPriceOracle set vault ${VAULT}: ${IS_OK}`)
  await vaultPriceOracle.setVault(VAULT, IS_OK)
  console.log("✅ Done")
}

export default func
func.tags = ["SetVault"]
