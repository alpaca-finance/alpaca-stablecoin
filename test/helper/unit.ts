import { BigNumber } from "ethers"
import { ethers } from "hardhat"

/**
 * wad: some quantity of tokens, usually as a fixed point integer with 18 decimal places.
 * ray: a fixed point integer, with 27 decimal places.
 * rad: a fixed point integer, with 45 decimal places.
 */

export const WeiPerWad = ethers.constants.WeiPerEther
export const WeiPerRay = BigNumber.from(`1${"0".repeat(27)}`)
export const WeiPerRad = BigNumber.from(`1${"0".repeat(45)}`)
