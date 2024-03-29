export interface Config {
  OpMultiSig: string
  Timelock: string
  ProxyAdmin: string
  ProxyWalletFactory: ProxyWalletFactory
  ProxyWalletRegistry: ProxyWalletRegistry
  AlpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  AccessControlConfig: AccessControlConfig
  AlpacaStablecoin: AlpacaStablecoins
  CollateralPoolConfig: CollateralPoolConfig
  BookKeeper: BookKeeper
  FlashMintModule: FlashMintModule
  ShowStopper: ShowStopper
  PositionManager: PositionManager
  GetPositions: GetPositions
  IbTokenAdapters: IbTokenAdapter[]
  AuthTokenAdapters: AuthTokenAdapter[]
  StablecoinAdapters: StablecoinAdapters
  PriceOracle: PriceOracle
  PriceFeed: PriceFeed
  Oracle: Oracle
  SystemDebtEngine: SystemDebtEngine
  LiquidationEngine: LiquidationEngine
  StabilityFeeCollector: StabilityFeeCollector
  Strategies: LiquidationStrategy
  FlashLiquidator: FlashLiquidator
  StableSwapModule: StableSwapModule
}
export interface ProxyWalletFactory {
  address: string
  deployedBlock: number
}
export interface ProxyWalletRegistry {
  address: string
  deployedBlock: number
}
export interface AlpacaStablecoinProxyActions {
  address: string
  deployedBlock: number
}
export interface AccessControlConfig {
  address: string
  deployedBlock: number
}
export interface AlpacaStablecoins {
  AUSD: AlpacaStablecoin
}
export interface AlpacaStablecoin {
  address: string
  deployedBlock: number
}
export interface CollateralPool {
  collateralPoolId: string
  debtCeiling: string
  debtFloor: string
  priceFeed: string
  liquidationRatio: string
  stabilityFeeRate: string
  adapter: string
  closeFactorBps: number
  liquidatorIncentiveBps: number
  treasuryFeesBps: number
  strategy: string
}
export interface CollateralPoolConfig {
  address: string
  deployedBlock: number
  collateralPools: CollateralPool[]
}
export interface BookKeeper {
  address: string
  deployedBlock: number
}
export interface FlashMintModule {
  address: string
  deployedBlock: number
}
export interface PriceOracle {
  address: string
  deployedBlock: number
}
export interface PriceFeed {
  AlpacaOraclePriceFeed: AlpacaOraclePriceFeed[]
  StrictAlpacaPriceOraclePriceFeed: StrictAlpacaPriceOraclePriceFeed[]
  IbTokenPriceFeed: IbTokenPriceFeed[]
  StaticPriceFeed: StaticPriceFeed[]
}
export interface AlpacaOraclePriceFeed {
  name: string
  address: string
  deployedBlock: number
  alpacaOracle: string
  token0: string
  token1: string
}
export interface StrictAlpacaPriceOraclePriceFeed {
  name: string
  address: string
  deployedBlock: number
  primarySoure: string
  secondary: string
  token0: string
  token1: string
}
export interface IbTokenPriceFeed {
  name: string
  address: string
  deployedBlock: number
  ibInBasePriceFeed: string
  baseInUsdPriceFeed: string
}
export interface StaticPriceFeed {
  address: string
  deployedBlock: number
}
export interface ShowStopper {
  address: string
  deployedBlock: number
}
export interface PositionManager {
  address: string
  deployedBlock: number
}
export interface GetPositions {
  address: string
  deployedBlock: number
}
export interface AuthTokenAdapter {
  address: string
  deployedBlock: number
}
export interface IbTokenAdapter {
  address: string
  deployedBlock: number
  collateralToken: string
  rewardToken: string
  treasuryFeeBps: string
  treasuryAccount: string
}
export interface StablecoinAdapter {
  address: string
  deployedBlock: number
  alpacaStablecoin: string
}
export interface StablecoinAdapters {
  AUSD: StablecoinAdapter
}
export interface SystemDebtEngine {
  address: string
}
export interface LiquidationEngine {
  address: string
  deployedBlock: number
}

export interface ChainLinkOracle {
  address: string
  deployedBlock: number
}

export interface SimpleOracle {
  address: string
  deployedBlock: number
}

export interface StdReferenceProxy {
  address: string
  deployedBlock: number
}

export interface BandPriceOracle {
  address: string
  deployedBlock: number
  StdReferenceProxy: StdReferenceProxy
}

export interface PricePriceOracle {
  address: string
  deployedBlock: number
}

export interface Oracle {
  ChainLinkOracle: ChainLinkOracle
  SimpleOracle: SimpleOracle
  BandPriceOracle: BandPriceOracle
  VaultPriceOracle: PricePriceOracle
}

export interface StabilityFeeCollector {
  address: string
  deployedBlock: number
}

export interface LiquidationStrategy {
  FixedSpreadLiquidationStrategy: FixedSpreadLiquidationStrategy
}

export interface FixedSpreadLiquidationStrategy {
  address: string
  deployedBlock: number
}

export interface FlashLiquidator {
  PCSFlashLiquidator: PCSFlashLiquidator
}

export interface PCSFlashLiquidator {
  address: string
  deployedBlock: number
}

export interface StableSwapModule {
  address: string
  deployedBlock: number
}
