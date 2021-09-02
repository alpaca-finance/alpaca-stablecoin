import { BigNumber } from "ethers"
import { ethers } from "hardhat"

export function formatBytes32BigNumber(n: BigNumber): string {
  return ethers.utils.hexZeroPad(n.toHexString(), 32)
}
