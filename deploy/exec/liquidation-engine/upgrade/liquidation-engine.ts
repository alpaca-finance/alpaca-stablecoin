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

  const TITLE = "upgrade_liquidation_engine";
  const EXACT_ETA = "1695343525";

  const deployer = await getDeployer();
  const chainId = await deployer.getChainId();
  const config = ConfigEntity.getConfig()

  const newLiquidationEngine = await ethers.getContractFactory("LiquidationEngine");
  const preparedLiquidationEngine = await upgrades.prepareUpgrade(config.LiquidationEngine.address, newLiquidationEngine);
  console.log(`> Implementation address: ${preparedLiquidationEngine}`);
  console.log("✅ Done");
  
  const ops = isFork() ? { gasLimit: 2000000 } : {};

  const timelockTransactions: Array<TimelockEntity.Transaction> = [];
  timelockTransactions.push(
    await TimelockService.queueTransaction(
      chainId,
      `> Queue tx to upgrade ${config.LiquidationEngine.address}`,
      config.ProxyAdmin,
      "0",
      "upgrade(address,address)",
      ["address", "address"],
      [config.LiquidationEngine.address, preparedLiquidationEngine],
      EXACT_ETA,
      ops
    )
  );

  await FileService.write(`${TITLE}`, timelockTransactions)
  
}

export default func
func.tags = ["UpgradeLiquidationEngine"]
