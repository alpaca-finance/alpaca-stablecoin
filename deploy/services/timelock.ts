import { ethers, network } from "hardhat"
import { Timelock__factory } from "@alpaca-finance/alpaca-contract/typechain"
import { ConfigEntity, TimelockEntity } from "../entities"
import { HttpNetworkConfig } from "hardhat/types"
import { GnosisSafeMultiSigService } from "./multisig/gnosis-safe"
import { CallOverrides } from "ethers"
import { getDeployer } from "./deployer-helper"

export async function queueTransaction(
  chainId: number,
  info: string,
  target: string,
  value: string,
  signature: string,
  paramTypes: Array<string>,
  params: Array<any>,
  eta: string,
  overrides?: CallOverrides
): Promise<TimelockEntity.Transaction> {
  const deployer = await getDeployer();
  console.log(`------------------`);
  console.log(`>> Queue tx for: ${info}`);

  const config = ConfigEntity.getConfig()
  const timelock = Timelock__factory.connect(config.Timelock, deployer);
  const timelockAdmin = await timelock.admin();

  let txHash = "";
  if (timelockAdmin.toLowerCase() === deployer.address.toLowerCase()) {
    // If Timelock's admin is deployer, queue the transaction
    const queueTx = await timelock.queueTransaction(
      target,
      value,
      signature,
      ethers.utils.defaultAbiCoder.encode(paramTypes, params),
      eta,
      { ...overrides }
    );
    await queueTx.wait();
  } else if (timelockAdmin.toLowerCase() === config.OpMultiSig.toLowerCase()) {
    // If Timelock's admin is OpMultiSig, propose queue tx to OpMultiSig
    if (process.env.DEPLOYER_PRIVATE_KEY === undefined) throw new Error("DEPLOYER_PRIVATE_KEY is not defined");

    const deployerWallet = new ethers.Wallet(
      process.env.DEPLOYER_PRIVATE_KEY,
      new ethers.providers.JsonRpcProvider((network.config as HttpNetworkConfig).url)
    );
    if (deployerWallet.address.toLowerCase() !== deployer.address.toLowerCase()) throw new Error("Delpoyer mismatch");

    const multiSig = new GnosisSafeMultiSigService(chainId, config.OpMultiSig, deployerWallet);
    txHash = await multiSig.proposeTransaction(
      timelock.address,
      "0",
      timelock.interface.encodeFunctionData("queueTransaction", [
        target,
        value,
        signature,
        ethers.utils.defaultAbiCoder.encode(paramTypes, params),
        eta,
      ])
    );
  } else {
    throw new Error("Timelock's admin is not deployer or OpMultiSig");
  }
  const paramTypesStr = paramTypes.map((p) => `'${p}'`);
  const paramsStr = params.map((p) => {
    if (Array.isArray(p)) {
      const vauleWithQuote = p.map((p) => {
        if (typeof p === "string") return `'${p}'`;
        return JSON.stringify(p);
      });
      return `[${vauleWithQuote}]`;
    }

    if (typeof p === "string") {
      return `'${p}'`;
    }

    return p;
  });

  const executionTx = `await timelock.executeTransaction('${target}', '${value}', '${signature}', ethers.utils.defaultAbiCoder.encode([${paramTypesStr}], [${paramsStr}]), '${eta}')`;
  console.log(`>> Done.`);
  return {
    chainId,
    info: info,
    queuedAt: txHash,
    executedAt: "",
    executionTransaction: executionTx,
    target,
    value,
    signature,
    paramTypes,
    params,
    eta,
  };
}

export async function executeTransaction(
  chainId: number,
  info: string,
  queuedAt: string,
  executionTx: string,
  target: string,
  value: string,
  signature: string,
  paramTypes: Array<string>,
  params: Array<any>,
  eta: string,
  overrides?: CallOverrides
): Promise<TimelockEntity.Transaction> {
  console.log(`>> Execute tx for: ${info}`);
  const config = ConfigEntity.getConfig()
  const timelock = Timelock__factory.connect(config.Timelock, await getDeployer());
  const executeTx = await timelock.executeTransaction(
    target,
    value,
    signature,
    ethers.utils.defaultAbiCoder.encode(paramTypes, params),
    eta,
    overrides
  );
  console.log(`>> Done.`);

  return {
    chainId,
    info: info,
    queuedAt: queuedAt,
    executedAt: executeTx.hash,
    executionTransaction: executionTx,
    target,
    value,
    signature,
    paramTypes,
    params,
    eta,
  };
}
