import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades, network } from "hardhat"
import MainnetConfig from "../../../../.mainnet.json"
import TestnetConfig from "../../../../.testnet.json"
import { Timelock__factory } from "@alpaca-finance/alpaca-contract/typechain"
import { IbTokenPriceFeed__factory } from "../../../../typechain"

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

  const IB_TOKEN_PRICE_FEED_ADDR = "0x4a89F897AA97D096dBeA0f874a5854662996f8ae"
  const EXACT_ETA = "1641637800"

  const config = network.name === "mainnet" ? MainnetConfig : TestnetConfig

  const timelock = Timelock__factory.connect(config.Timelock, (await ethers.getSigners())[0])

  console.log(`============`)
  console.log(`>> Upgrading IbTokenPriceFeed through Timelock + ProxyAdmin`)
  console.log(">> Prepare upgrade & deploy if needed a new IMPL automatically.")
  const NewIbTokenPriceFeedFactory = (await ethers.getContractFactory("IbTokenPriceFeed")) as IbTokenPriceFeed__factory
  const prepareNewIbTokenPriceFeed = await upgrades.prepareUpgrade(IB_TOKEN_PRICE_FEED_ADDR, NewIbTokenPriceFeedFactory)
  console.log(`>> Implementation address: ${prepareNewIbTokenPriceFeed}`)
  console.log("✅ Done")

  console.log(`>> Queue tx on Timelock to upgrade the implementation`)
  await timelock.queueTransaction(
    config.ProxyAdmin,
    "0",
    "upgrade(address,address)",
    ethers.utils.defaultAbiCoder.encode(["address", "address"], [IB_TOKEN_PRICE_FEED_ADDR, prepareNewIbTokenPriceFeed]),
    EXACT_ETA
  )
  console.log("✅ Done")

  console.log(`>> Generate executeTransaction:`)
  console.log(
    `await timelock.executeTransaction('${config.ProxyAdmin}', '0', 'upgrade(address,address)', ethers.utils.defaultAbiCoder.encode(['address','address'], ['${IB_TOKEN_PRICE_FEED_ADDR}','${prepareNewIbTokenPriceFeed}']), ${EXACT_ETA})`
  )
  console.log("✅ Done")
}

export default func
func.tags = ["UpgradeIbTokenPriceFeed"]
