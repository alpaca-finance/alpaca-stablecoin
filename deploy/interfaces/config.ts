export interface Config {
  Timelock: string
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
  PriceOracle: PriceOracle
  SystemDebtEngine: SystemDebtEngine
  LiquidationEngine: LiquidationEngine
}
export interface ProxyWalletFactory {
  address: string
}
export interface ProxyWalletRegistry {
  address: string
}
export interface AlpacaStablecoinProxyActions {
  address: string
}
export interface AccessControlConfig {
  address: string
}
export interface AlpacaStablecoins {
  AUSD: AlpacaStablecoin
}
export interface AlpacaStablecoin {
  address: string
}
export interface CollateralPoolConfig {
  address: string
}
export interface BookKeeper {
  address: string
}
export interface FlashMintModule {
  address: string
}
export interface PriceOracle {
  address: string
}
export interface ShowStopper {
  address: string
}
export interface PositionManager {
  address: string
}
export interface GetPositions {
  address: string
}
export interface Adapter {
  address: string
  collateralToken: string
  rewardToken: string
  treasuryFeeBps: string
  treasuryAccount: string
}
export interface SystemDebtEngine {
  address: string
}
export interface LiquidationEngine {
  address: string
}
