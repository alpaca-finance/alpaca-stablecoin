import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades, network } from "hardhat"
import MainnetConfig from "../../../../.mainnet.json"
import TestnetConfig from "../../../../.testnet.json"
import { Timelock__factory } from "@alpaca-finance/alpaca-contract/typechain"
import { PCSFlashLiquidator__factory } from "../../../../typechain"

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

  const EXACT_ETA = ""

  const config = network.name === "mainnet" ? MainnetConfig : TestnetConfig

  const timelock = Timelock__factory.connect(config.Timelock, (await ethers.getSigners())[0])

  console.log(`============`)
  console.log(`>> Upgrading PCSFlashLiquidator through Timelock + ProxyAdmin`)
  console.log(">> Prepare upgrade & deploy if needed a new IMPL automatically.")
  const NewPCSFlashLiquidatorFactory = (await ethers.getContractFactory(
    "PCSFlashLiquidator"
  )) as PCSFlashLiquidator__factory
  const prepareNewPCSFlashLiquidator = await upgrades.prepareUpgrade(
    config.FlashLiquidator.PCSFlashLiquidator.address,
    NewPCSFlashLiquidatorFactory
  )
  console.log(`>> Implementation address: ${prepareNewPCSFlashLiquidator}`)
  console.log("✅ Done")

  console.log(`>> Queue tx on Timelock to upgrade the implementation`)
  await timelock.queueTransaction(
    config.ProxyAdmin,
    "0",
    "upgrade(address,address)",
    ethers.utils.defaultAbiCoder.encode(
      ["address", "address"],
      [config.FlashLiquidator.PCSFlashLiquidator.address, prepareNewPCSFlashLiquidator]
    ),
    EXACT_ETA
  )
  console.log("✅ Done")

  console.log(`>> Generate executeTransaction:`)
  console.log(
    `await timelock.executeTransaction('${config.ProxyAdmin}', '0', 'upgrade(address,address)', ethers.utils.defaultAbiCoder.encode(['address','address'], ['${config.FlashLiquidator.PCSFlashLiquidator.address}','${prepareNewPCSFlashLiquidator}']), ${EXACT_ETA})`
  )
  console.log("✅ Done")
}

export default func
func.tags = ["UpgradePCSFlashLiquidator"]
