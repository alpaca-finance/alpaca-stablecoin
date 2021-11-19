import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { AlpacaStablecoin__factory } from "../../../../typechain"
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

  const NAME = "Alpaca USD"
  const SYMBOL = "AUSD"

  console.log(">> Deploying an upgradable AlpacaStablecoin contract")
  const AlpacaStablecoin = (await ethers.getContractFactory(
    "AlpacaStablecoin",
    (
      await ethers.getSigners()
    )[0]
  )) as AlpacaStablecoin__factory
  const alpacaStablecoin = await upgrades.deployProxy(AlpacaStablecoin, [NAME, SYMBOL])
  await alpacaStablecoin.deployed()
  console.log(`>> Deployed at ${alpacaStablecoin.address}`)
  const tx = await alpacaStablecoin.deployTransaction.wait()
  console.log(`>> Deploy block ${tx.blockNumber}`)
}

export default func
func.tags = ["AlpacaStablecoin"]
