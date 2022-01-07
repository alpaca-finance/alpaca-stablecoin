import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { FixedSpreadLiquidationStrategy__factory, IbTokenAdapter__factory } from "../../../../../typechain"
import { ConfigEntity } from "../../../../entities"
import { formatBytes32String } from "ethers/lib/utils"
import { BigNumber } from "ethers"

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

  console.log(">> Deploying an upgradable FixedSpreadLiquidationStrategy contract")
  const FixedSpreadLiquidationStrategy = (await ethers.getContractFactory(
    "FixedSpreadLiquidationStrategy",
    (
      await ethers.getSigners()
    )[0]
  )) as FixedSpreadLiquidationStrategy__factory
  const fixedSpreadLiquidationStrategy = await upgrades.deployProxy(FixedSpreadLiquidationStrategy, [
    config.BookKeeper.address,
    config.PriceOracle.address,
    config.LiquidationEngine.address,
    config.SystemDebtEngine.address,
  ])
  await fixedSpreadLiquidationStrategy.deployed()
  console.log(`>> Deployed at ${fixedSpreadLiquidationStrategy.address}`)
  const tx = await fixedSpreadLiquidationStrategy.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["FixedSpreadLiquidationStrategy"]
