import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { TokenAdapter, TokenAdapter__factory } from "../../../typechain"
import { ModifiableContract, smoddit } from "@eth-optimism/smock"

type fixture = {
  tokenAdapter: TokenAdapter
  mockedBookKeeper: ModifiableContract
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked booster config
  const BookKeeperFactory = await smoddit("BookKeeper", deployer)
  const mockedBookKeeper = await BookKeeperFactory.deploy()

  // Deploy TokenAdapter
  const TokenAdapter = (await ethers.getContractFactory("TokenAdapter", deployer)) as TokenAdapter__factory
  const tokenAdapter = (await upgrades.deployProxy(TokenAdapter, [mockedBookKeeper.address])) as TokenAdapter
  await tokenAdapter.deployed()

  return { tokenAdapter, mockedBookKeeper }
}

describe("TokenAdapter", () => {
  // Accounts
  let deployer: Signer

  //Contract
  let tokenAdapter: TokenAdapter
  let mockedBookKeeper: ModifiableContract

  beforeEach(async () => {
    //waffle
    ;({ tokenAdapter, mockedBookKeeper } = await waffle.loadFixture(loadFixtureHandler))
  })
})
