import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { BookKeeper__factory, CDPManager, CDPManager__factory, BookKeeper } from "../../../typechain"
import { ModifiableContract, smoddit, smockit, MockContract } from "@eth-optimism/smock"

chai.use(solidity)
const { expect } = chai
const { AddressZero, WeiPerEther } = ethers.constants
const { parseEther, formatBytes32String } = ethers.utils

type fixture = {
  cdpManager: CDPManager
  mockedBookKeeper: MockContract
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const BookKeeper = (await ethers.getContractFactory("BookKeeper", deployer)) as BookKeeper__factory
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [])) as BookKeeper
  await bookKeeper.deployed()
  const mockedBookKeeper = await smockit(bookKeeper)

  // Deploy CDPManager
  const CDPManager = (await ethers.getContractFactory("CDPManager", deployer)) as CDPManager__factory
  const cdpManager = (await upgrades.deployProxy(CDPManager, [mockedBookKeeper.address])) as CDPManager
  await cdpManager.deployed()

  return { cdpManager, mockedBookKeeper }
}

describe("CDPManager", () => {
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
  let cdpManager: CDPManager
  let bookKeeper: BookKeeper
  let mockedBookKeeper: MockContract
  let cdpManagerAsAlice: CDPManager

  beforeEach(async () => {
    ;({ cdpManager, mockedBookKeeper } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])

    cdpManagerAsAlice = CDPManager__factory.connect(cdpManager.address, alice) as CDPManager
  })

  describe("#open()", () => {
    context("when supply zero address", () => {
      it("should revert", async () => {
        await expect(cdpManager.open(formatBytes32String("BNB"), AddressZero)).to.be.revertedWith("usr-address-0")
      })
    })
    context("when parameters are valid", () => {
      it("should be able to open CDP with an incremental CDP index", async () => {
        expect(await cdpManager.owns(1)).to.equal(AddressZero)
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        expect(await cdpManager.cdpi()).to.bignumber.equal(1)
        expect(await cdpManager.owns(1)).to.equal(aliceAddress)

        expect(await cdpManager.owns(2)).to.equal(AddressZero)
        await cdpManager.open(formatBytes32String("BNB"), bobAddress)
        expect(await cdpManager.cdpi()).to.bignumber.equal(2)
        expect(await cdpManager.owns(2)).to.equal(bobAddress)

        expect(await cdpManager.owns(3)).to.equal(AddressZero)
        await cdpManager.open(formatBytes32String("COL"), aliceAddress)
        expect(await cdpManager.cdpi()).to.bignumber.equal(3)
        expect(await cdpManager.owns(3)).to.equal(aliceAddress)
      })
    })
  })

  describe("#give()", () => {
    context("when caller is not the owner of the cdp (or have no allowance)", () => {
      it("should revert", async () => {
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(cdpManager.give(1, aliceAddress)).to.be.revertedWith("cdp-not-allowed")
      })
    })
    context("when input destination as zero address", () => {
      it("should revert", async () => {
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(cdpManagerAsAlice.give(1, AddressZero)).to.be.revertedWith("dst-address-0")
      })
    })
    context("when input destination as current owner address", () => {
      it("should revert", async () => {
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(cdpManagerAsAlice.give(1, aliceAddress)).to.be.revertedWith("dst-already-owner")
      })
    })
    context("when parameters are valid", () => {
      it("should be able to change the owner of CDP ", async () => {
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        expect(await cdpManager.owns(1)).to.equal(aliceAddress)
        await cdpManagerAsAlice.give(1, bobAddress)
        expect(await cdpManager.owns(1)).to.equal(bobAddress)
      })
    })
  })

  describe("#cdpAllow()", () => {
    context("when caller is not the owner of the cdp (or have no allowance)", () => {
      it("should revert", async () => {
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(cdpManager.cdpAllow(1, aliceAddress, 1)).to.be.revertedWith("cdp-not-allowed")
      })
    })
    context("when parameters are valid", () => {
      it("should be able to add user allowance to a cdp", async () => {
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        expect(await cdpManager.cdpCan(aliceAddress, 1, bobAddress)).to.bignumber.equal(0)
        await cdpManagerAsAlice.cdpAllow(1, bobAddress, 1)
        expect(await cdpManager.cdpCan(aliceAddress, 1, bobAddress)).to.bignumber.equal(1)
      })
    })
  })

  describe("#list()", () => {
    context("when a few cdp has been opened", () => {
      it("should work as a linklist perfectly", async () => {
        // Alice open cdp 1-3
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)

        // Bob open cdp 4-7
        await cdpManager.open(formatBytes32String("BNB"), bobAddress)
        await cdpManager.open(formatBytes32String("BNB"), bobAddress)
        await cdpManager.open(formatBytes32String("BNB"), bobAddress)
        await cdpManager.open(formatBytes32String("BNB"), bobAddress)

        let [aliceCount, aliceFirst, aliceLast] = await Promise.all([
          cdpManager.count(aliceAddress),
          cdpManager.first(aliceAddress),
          cdpManager.last(aliceAddress),
        ])
        expect(aliceCount).to.bignumber.equal(3)
        expect(aliceFirst).to.bignumber.equal(1)
        expect(aliceLast).to.bignumber.equal(3)
        expect(await cdpManager.list(1)).to.be.deep.equal([BigNumber.from(0), BigNumber.from(2)])
        expect(await cdpManager.list(2)).to.be.deep.equal([BigNumber.from(1), BigNumber.from(3)])
        expect(await cdpManager.list(3)).to.be.deep.equal([BigNumber.from(2), BigNumber.from(0)])

        let [bobCount, bobFirst, bobLast] = await Promise.all([
          cdpManager.count(bobAddress),
          cdpManager.first(bobAddress),
          cdpManager.last(bobAddress),
        ])
        expect(bobCount).to.bignumber.equal(4)
        expect(bobFirst).to.bignumber.equal(4)
        expect(bobLast).to.bignumber.equal(7)
        expect(await cdpManager.list(4)).to.be.deep.equal([BigNumber.from(0), BigNumber.from(5)])
        expect(await cdpManager.list(5)).to.be.deep.equal([BigNumber.from(4), BigNumber.from(6)])
        expect(await cdpManager.list(6)).to.be.deep.equal([BigNumber.from(5), BigNumber.from(7)])
        expect(await cdpManager.list(7)).to.be.deep.equal([BigNumber.from(6), BigNumber.from(0)])

        // try giving cdp 2 to Bob, the CDP#2 should be concat at the end of the link list
        await cdpManagerAsAlice.give(2, bobAddress)
        ;[aliceCount, aliceFirst, aliceLast] = await Promise.all([
          cdpManager.count(aliceAddress),
          cdpManager.first(aliceAddress),
          cdpManager.last(aliceAddress),
        ])
        expect(aliceCount).to.bignumber.equal(2)
        expect(aliceFirst).to.bignumber.equal(1)
        expect(aliceLast).to.bignumber.equal(3)
        expect(await cdpManager.list(1)).to.be.deep.equal([BigNumber.from(0), BigNumber.from(3)])
        expect(await cdpManager.list(3)).to.be.deep.equal([BigNumber.from(1), BigNumber.from(0)])
        ;[bobCount, bobFirst, bobLast] = await Promise.all([
          cdpManager.count(bobAddress),
          cdpManager.first(bobAddress),
          cdpManager.last(bobAddress),
        ])
        expect(bobCount).to.bignumber.equal(5)
        expect(bobFirst).to.bignumber.equal(4)
        expect(bobLast).to.bignumber.equal(2) // CDP#2 concatted at the end of the list
        expect(await cdpManager.list(4)).to.be.deep.equal([BigNumber.from(0), BigNumber.from(5)])
        expect(await cdpManager.list(5)).to.be.deep.equal([BigNumber.from(4), BigNumber.from(6)])
        expect(await cdpManager.list(6)).to.be.deep.equal([BigNumber.from(5), BigNumber.from(7)])
        expect(await cdpManager.list(7)).to.be.deep.equal([BigNumber.from(6), BigNumber.from(2)])
        expect(await cdpManager.list(2)).to.be.deep.equal([BigNumber.from(7), BigNumber.from(0)])
      })
    })
  })

  describe("#adjustPosition()", () => {
    context("when caller is not the owner of the cdp (or have no allowance)", () => {
      it("should revert", async () => {
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(cdpManager.adjustPosition(1, parseEther("1"), parseEther("50"))).to.be.revertedWith(
          "cdp-not-allowed"
        )
      })
    })
    context("when parameters are valid", async () => {
      it("should be able to call BookKeeper.adjustPosition", async () => {
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        const positionAddress = await cdpManager.positions(1)

        mockedBookKeeper.smocked.adjustPosition.will.return.with()
        await cdpManagerAsAlice.adjustPosition(1, parseEther("1"), parseEther("50"))

        const { calls } = mockedBookKeeper.smocked.adjustPosition
        expect(calls.length).to.be.equal(1)
        expect(calls[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(calls[0].positionAddress).to.be.equal(positionAddress)
        expect(calls[0].collateralOwner).to.be.equal(positionAddress)
        expect(calls[0].stablecoinOwner).to.be.equal(positionAddress)
        expect(calls[0].collateralValue).to.be.equal(parseEther("1"))
        expect(calls[0].debtShare).to.be.equal(parseEther("50"))
      })
    })
  })

  describe("#moveCollateral(uint256,address,uint256)", () => {
    context("when caller is not the owner of the cdp", () => {
      it("should revert", async () => {
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(
          cdpManager["moveCollateral(uint256,address,uint256)"](1, aliceAddress, parseEther("50"))
        ).to.be.revertedWith("cdp-not-allowed")
      })
    })
    context("when parameters are valid", async () => {
      it("should be able to call moveCollateral(uint256,address,uint256)", async () => {
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        const positionAddress = await cdpManager.positions(1)

        mockedBookKeeper.smocked.moveCollateral.will.return.with()
        await cdpManagerAsAlice["moveCollateral(uint256,address,uint256)"](1, bobAddress, parseEther("1"))

        const { calls } = mockedBookKeeper.smocked.moveCollateral
        expect(calls.length).to.be.equal(1)
        expect(calls[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(calls[0].src).to.be.equal(positionAddress)
        expect(calls[0].dst).to.be.equal(bobAddress)
        expect(calls[0].wad).to.be.equal(parseEther("1"))
      })
    })
  })

  // This function has the purpose to take away collateral from the system that doesn't correspond to the cdp but was sent there wrongly.
  describe("#moveCollateral(bytes32,uint256,address,uint256)", () => {
    context("when caller is not the owner of the cdp", () => {
      it("should revert", async () => {
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        await expect(
          cdpManager["moveCollateral(bytes32,uint256,address,uint256)"](
            formatBytes32String("BNB"),
            1,
            aliceAddress,
            parseEther("50")
          )
        ).to.be.revertedWith("cdp-not-allowed")
      })
    })
    context("when parameters are valid", async () => {
      it("should be able to call moveCollateral(bytes32,uint256,address,uint256)", async () => {
        await cdpManager.open(formatBytes32String("BNB"), aliceAddress)
        const positionAddress = await cdpManager.positions(1)

        mockedBookKeeper.smocked.moveCollateral.will.return.with()
        await cdpManagerAsAlice["moveCollateral(bytes32,uint256,address,uint256)"](
          formatBytes32String("BNB"),
          1,
          bobAddress,
          parseEther("1")
        )

        const { calls } = mockedBookKeeper.smocked.moveCollateral
        expect(calls.length).to.be.equal(1)
        expect(calls[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
        expect(calls[0].src).to.be.equal(positionAddress)
        expect(calls[0].dst).to.be.equal(bobAddress)
        expect(calls[0].wad).to.be.equal(parseEther("1"))
      })
    })
  })
})
