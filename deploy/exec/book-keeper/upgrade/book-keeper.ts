import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { ConfigEntity, TimelockEntity } from "../../../entities"
import { FileService, TimelockService } from "../../../services"
import { getDeployer, isFork } from "../../../services/deployer-helper"

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

  const TITLE = "upgrade_book_keeper";
  const EXACT_ETA = "1695790799";

  const deployer = await getDeployer();
  const chainId = await deployer.getChainId();
  const config = ConfigEntity.getConfig()

  const newBookKeeper = await ethers.getContractFactory("BookKeeper");
  const preparedBookKeeper = await upgrades.prepareUpgrade(config.BookKeeper.address, newBookKeeper);
  console.log(`> Implementation address: ${preparedBookKeeper}`);
  console.log("✅ Done");
  
  const ops = isFork() ? { gasLimit: 2000000 } : {};

  const timelockTransactions: Array<TimelockEntity.Transaction> = [];
  timelockTransactions.push(
    await TimelockService.queueTransaction(
      chainId,
      `> Queue tx to upgrade ${config.BookKeeper.address}`,
      config.ProxyAdmin,
      "0",
      "upgrade(address,address)",
      ["address", "address"],
      [config.BookKeeper.address, preparedBookKeeper],
      EXACT_ETA,
      ops
    )
  );

  await FileService.write(`${TITLE}`, timelockTransactions)
  
}

export default func
func.tags = ["UpgradeBookKeeper"]
