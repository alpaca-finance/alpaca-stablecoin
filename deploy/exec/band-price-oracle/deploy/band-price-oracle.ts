import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { BandPriceOracle__factory } from "../../../../typechain"
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

  const STD_REFERENCE_PROXY_ADDR = "0xDA7a001b254CD22e46d3eAB04d937489c93174C3"
  const config = ConfigEntity.getConfig()

  console.log(">> Deploying an upgradable BandPriceOracle contract")
  const BandPriceOracle = (await ethers.getContractFactory(
    "BandPriceOracle",
    (
      await ethers.getSigners()
    )[0]
  )) as BandPriceOracle__factory
  const bandPriceOracle = await upgrades.deployProxy(BandPriceOracle, [
    STD_REFERENCE_PROXY_ADDR,
    config.AccessControlConfig.address,
  ])
  await bandPriceOracle.deployed()
  console.log(`>> Deployed at ${bandPriceOracle.address}`)
  const tx = await bandPriceOracle.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["BandPriceOracle"]
