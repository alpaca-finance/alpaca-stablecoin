import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers, network } from "hardhat";
import { JsonRpcProvider } from "@ethersproject/providers";
import { HttpNetworkUserConfig } from "hardhat/types";

export async function getDeployer(): Promise<SignerWithAddress> {
  const [defaultDeployer] = await ethers.getSigners();

  if (isFork()) {
    const provider = ethers.getDefaultProvider((network.config as HttpNetworkUserConfig).url) as JsonRpcProvider;
    const signer = provider.getSigner("0xC44f82b07Ab3E691F826951a6E335E1bC1bB0B51");
    const mainnetForkDeployer = await SignerWithAddress.create(signer);

    return mainnetForkDeployer;
  }

  return defaultDeployer;
}

export function isFork() {
  const networkUrl = (network.config as HttpNetworkUserConfig).url;
  if (networkUrl) {
    return networkUrl.indexOf("https://rpc.tenderly.co/fork/") !== -1;
  }
  throw new Error("invalid Network Url");
}
