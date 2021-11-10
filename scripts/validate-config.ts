import { expect } from "chai"
import { ethers, network } from "hardhat"
import "@openzeppelin/test-helpers"
import MainnetConfig from "../.mainnet.json"
import TestnetConfig from "../.testnet.json"
import { IbTokenAdapter, CollateralPool } from "../deploy/interfaces/config"
import { CollateralPoolConfig, CollateralPoolConfig__factory, IbTokenAdapter__factory } from "../typechain"

async function validateCollateralPool(collateralPoolConfig: CollateralPoolConfig, collateralPoolInfo: CollateralPool) {
  const collateralPool = await collateralPoolConfig.collateralPools(
    ethers.utils.formatBytes32String(collateralPoolInfo.collateralPoolId)
  )
  try {
    expect(collateralPool.debtCeiling.toString()).to.be.equal(collateralPoolInfo.debtCeiling, "debtCeiling mis-config")
    expect(collateralPool.debtFloor.toString()).to.be.equal(collateralPoolInfo.debtFloor, "debtFloor mis-config")
    expect(collateralPool.priceFeed).to.be.equal(collateralPoolInfo.priceFeed, "priceFeed mis-config")
    expect(collateralPool.liquidationRatio.toString()).to.be.equal(
      collateralPoolInfo.liquidationRatio,
      "liquidationRatio mis-config"
    )
    expect(collateralPool.stabilityFeeRate.toString()).to.be.equal(
      collateralPoolInfo.stabilityFeeRate,
      "stabilityFeeRate mis-config"
    )
    expect(collateralPool.adapter).to.be.equal(collateralPoolInfo.adapter, "adapter mis-config")
    expect(collateralPool.closeFactorBps.toNumber()).to.be.equal(
      collateralPoolInfo.closeFactorBps,
      "closeFactorBps mis-config"
    )
    expect(collateralPool.liquidatorIncentiveBps.toNumber()).to.be.equal(
      collateralPoolInfo.liquidatorIncentiveBps,
      "liquidatorIncentiveBps mis-config"
    )
    expect(collateralPool.treasuryFeesBps.toNumber()).to.be.equal(
      collateralPoolInfo.treasuryFeesBps,
      "treasuryFeesBps mis-config"
    )
    expect(collateralPool.strategy).to.be.equal(collateralPoolInfo.strategy, "strategy mis-config")

    console.log(`> ✅ done validated ${collateralPoolInfo.collateralPoolId}, no problem found`)
  } catch (e) {
    console.log(`> ❌ some problem found in ${collateralPoolInfo.collateralPoolId}, please double check`)
    console.log(e)
  }
}

async function validateIbTokenAdapter(adapterInfo: IbTokenAdapter) {
  const adapter = IbTokenAdapter__factory.connect(adapterInfo.address, ethers.provider)
  try {
    expect(await adapter.collateralToken()).to.be.equal(adapterInfo.collateralToken)
    expect(await adapter.rewardToken()).to.be.equal(adapterInfo.rewardToken)
    expect(await adapter.treasuryFeeBps()).to.be.equal(adapterInfo.treasuryFeeBps)
    expect(await adapter.treasuryAccount()).to.be.equal(adapterInfo.treasuryAccount)

    console.log(`> ✅ done validated ${adapterInfo.address}, no problem found`)
  } catch (e) {
    console.log(`> ❌ some problem found in ${adapterInfo.address}, please double check`)
    console.log(e)
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const config = network.name === "mainnet" ? MainnetConfig : TestnetConfig

  console.log("=== validate ibTokenAdapter config ===")
  const validateIbTokenAdapters = []
  for (const ibTokenAdapter of config.IbTokenAdapters) {
    validateIbTokenAdapters.push(validateIbTokenAdapter(ibTokenAdapter))
  }
  await Promise.all(validateIbTokenAdapters)

  const collateralPoolConfig = CollateralPoolConfig__factory.connect(
    config.CollateralPoolConfig.address,
    ethers.provider
  )
  console.log("=== validate collateralPool config ===")
  const validateCollateralPools = []
  for (const collateralPool of config.CollateralPoolConfig.collateralPools) {
    validateCollateralPools.push(validateCollateralPool(collateralPoolConfig, collateralPool as CollateralPool))
  }
  await Promise.all(validateCollateralPools)
  await delay(3000)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
