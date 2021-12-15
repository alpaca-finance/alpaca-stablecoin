import { expect } from "chai"
import { ethers, network } from "hardhat"
import "@openzeppelin/test-helpers"
import MainnetConfig from "../.mainnet.json"
import TestnetConfig from "../.testnet.json"
import { IbTokenAdapter, CollateralPool, BookKeeper, PriceOracle } from "../deploy/interfaces/config"
import {
  AccessControlConfig,
  AccessControlConfig__factory,
  AlpacaStablecoin__factory,
  CollateralPoolConfig,
  CollateralPoolConfig__factory,
  IbTokenAdapter__factory,
} from "../typechain"

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

async function validateRole(
  accessContralConfig: AccessControlConfig,
  config: typeof MainnetConfig | typeof TestnetConfig
) {
  try {
    const accessControlConfig = AccessControlConfig__factory.connect(accessContralConfig.address, ethers.provider)
    // PRICE_ORACLE_ROLE
    expect(
      await accessControlConfig.hasRole(await accessControlConfig.PRICE_ORACLE_ROLE(), config.PriceOracle.address)
    ).to.be.equal(true, `${config.PriceOracle.address}, PRICE_ORACLE_ROLE mis-config`)
    // ADAPTER_ROLE
    config.IbTokenAdapters.forEach(async (o) => {
      expect(await accessControlConfig.hasRole(await accessControlConfig.ADAPTER_ROLE(), o.address)).to.be.equal(
        true,
        `${o.address}, ADAPTER_ROLE mis-config`
      )
    })
    // LIQUIDATION_ENGINE_ROLE
    expect(
      await accessControlConfig.hasRole(
        await accessControlConfig.LIQUIDATION_ENGINE_ROLE(),
        config.LiquidationEngine.address
      )
    ).to.be.equal(true, `${config.LiquidationEngine.address}, LIQUIDATION_ENGINE_ROLE mis-config`)
    expect(
      await accessControlConfig.hasRole(
        await accessControlConfig.LIQUIDATION_ENGINE_ROLE(),
        config.Strategies.FixedSpreadLiquidationStrategy.address
      )
    ).to.be.equal(
      true,
      `${config.Strategies.FixedSpreadLiquidationStrategy.address}, LIQUIDATION_ENGINE_ROLE mis-config`
    )
    // STABILITY_FEE_COLLECTOR_ROLE
    expect(
      await accessControlConfig.hasRole(
        await accessControlConfig.STABILITY_FEE_COLLECTOR_ROLE(),
        config.StabilityFeeCollector.address
      )
    ).to.be.equal(true, `${config.StabilityFeeCollector.address}, STABILITY_FEE_COLLECTOR_ROLE mis-config`)
    // SHOW_STOPPER_ROLE
    expect(
      await accessControlConfig.hasRole(await accessControlConfig.SHOW_STOPPER_ROLE(), config.ShowStopper.address)
    ).to.be.equal(true, `${config.ShowStopper.address}, SHOW_STOPPER_ROLE mis-config`)
    // POSITION_MANAGER_ROLE
    expect(
      await accessControlConfig.hasRole(
        await accessControlConfig.POSITION_MANAGER_ROLE(),
        config.PositionManager.address
      )
    ).to.be.equal(true, `${config.PositionManager.address}, POSITION_MANAGER_ROLE mis-config`)
    // MINTABLE_ROLE
    // TO DO: When FlashMintModule deploy
    // expect(
    //   await accessControlConfig.hasRole(await accessControlConfig.MINTABLE_ROLE(), config.FlashMintModule.address)
    // ).to.be.equal(true, `${config.FlashMintModule.address}, MINTABLE_ROLE mis-config`)
    // BOOK_KEEPER_ROLE
    expect(
      await accessControlConfig.hasRole(await accessControlConfig.BOOK_KEEPER_ROLE(), config.BookKeeper.address)
    ).to.be.equal(true, `${config.BookKeeper.address}, BOOK_KEEPER_ROLE mis-config`)
    // COLLATERAL_MANAGER_ROLE
    expect(
      await accessControlConfig.hasRole(
        await accessControlConfig.COLLATERAL_MANAGER_ROLE(),
        config.Strategies.FixedSpreadLiquidationStrategy.address
      )
    ).to.be.equal(
      true,
      `${config.Strategies.FixedSpreadLiquidationStrategy.address}, COLLATERAL_MANAGER_ROLE mis-config`
    )
    // MINTER_ROLE
    const AUSD = AlpacaStablecoin__factory.connect(config.AlpacaStablecoin.AUSD.address, ethers.provider)
    expect(await AUSD.hasRole(await AUSD.MINTER_ROLE(), config.StablecoinAdapters.AUSD.address)).to.be.equal(
      true,
      `${config.StablecoinAdapters.AUSD.address}, MINTER_ROLE mis-config`
    )
    // OWNER_ROLE
    expect(
      await accessControlConfig.hasRole(
        await accessControlConfig.OWNER_ROLE(),
        "0xC44f82b07Ab3E691F826951a6E335E1bC1bB0B51"
      )
    ).to.be.equal(true, `${"0xC44f82b07Ab3E691F826951a6E335E1bC1bB0B51"}, OWNER_ROLE mis-config`)
    // GOV_ROLE
    expect(
      await accessControlConfig.hasRole(
        await accessControlConfig.GOV_ROLE(),
        "0xC44f82b07Ab3E691F826951a6E335E1bC1bB0B51"
      )
    ).to.be.equal(true, `${"0xC44f82b07Ab3E691F826951a6E335E1bC1bB0B51"}, GOV_ROLE mis-config`)

    console.log(`> ✅ done validated, no problem found`)
  } catch (e) {
    console.log(`> ❌ some problem found in validateRole, please double check`)
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

  const accessContralConfig = AccessControlConfig__factory.connect(config.AccessControlConfig.address, ethers.provider)
  console.log("=== validate Role config ===")
  await validateRole(accessContralConfig, config)
  await delay(3000)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
