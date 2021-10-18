export interface Config {
  Timelock: string
  CollateralPoolConfig: CollateralPoolConfig
  AccessControlConfig: AccessControlConfig
  BookKeeper: BookKeeper
  FlashMintModule: FlashMintModule
}

export interface CollateralPoolConfig {
  address: string
}

export interface AccessControlConfig {
  address: string
}

export interface BookKeeper {
  address: string
}

export interface FlashMintModule {
  address: string
}
