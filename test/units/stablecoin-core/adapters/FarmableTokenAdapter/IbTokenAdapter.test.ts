import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import {
  BookKeeper__factory,
  PositionManager,
  BookKeeper,
  BEP20__factory,
  IbTokenAdapter__factory,
  IbTokenAdapter,
} from "../../../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"
import { WeiPerRad, WeiPerWad } from "../../../../helper/unit"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { parseEther, formatBytes32String } = ethers.utils

type fixture = {
  ibTokenAdapter: IbTokenAdapter
  mockedBookKeeper: MockContract
  mockedDummyToken: MockContract
  mockedRewardToken: MockContract
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const BookKeeper = (await ethers.getContractFactory("BookKeeper", deployer)) as BookKeeper__factory
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [])) as BookKeeper
  await bookKeeper.deployed()
  const mockedBookKeeper = await smockit(bookKeeper)

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const dummyToken = await BEP20.deploy("dummy", "DUMP")
  await dummyToken.deployed()
  const mockedDummyToken = await smockit(dummyToken)

  const rewardToken = await BEP20.deploy("reward", "REWARD")
  await rewardToken.deployed()
  const mockedRewardToken = await smockit(rewardToken)

  const IbTokenAdapter = (await ethers.getContractFactory("IbTokenAdapter", deployer)) as IbTokenAdapter__factory
  const ibTokenAdapter = (await upgrades.deployProxy(IbTokenAdapter, [
    mockedBookKeeper.address,
    formatBytes32String("DUMMY"),
    mockedDummyToken.address,
  ])) as IbTokenAdapter
  await ibTokenAdapter.deployed()

  return { ibTokenAdapter, mockedBookKeeper, mockedDummyToken, mockedRewardToken }
}

describe("IbTokenAdapter", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer
  let bob: Signer
  let dev: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string
  let bobAddress: string
  let devAddress: string

  // Contracts
  let ibTokenAdapter: IbTokenAdapter

  let mockedBookKeeper: MockContract
  let mockedDummyToken: MockContract
  let mockedRewardToken: MockContract

  // Signer
  let positionManagerAsAlice: PositionManager
  let positionManagerAsBob: PositionManager

  beforeEach(async () => {
    ;({ ibTokenAdapter, mockedBookKeeper, mockedDummyToken, mockedRewardToken } = await waffle.loadFixture(
      loadFixtureHandler
    ))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])
  })
})
