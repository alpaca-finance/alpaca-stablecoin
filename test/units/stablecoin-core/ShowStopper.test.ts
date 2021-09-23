import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber } from "ethers"
import chai from "chai"
import { solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { ShowStopper, ShowStopper__factory } from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"

import * as UnitHelpers from "../../helper/unit"
import { formatBytes32BigNumber } from "../../helper/format"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { formatBytes32String } = ethers.utils

type fixture = {
  showStopper: ShowStopper
  mockedBookKeeper: MockContract
  mockedLiquidationEngine: MockContract
  mockedSystemDebtEngine: MockContract
  mockedPriceOracle: MockContract
  mockedPriceFeed: MockContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const mockedBookKeeper = await smockit(await ethers.getContractFactory("BookKeeper", deployer))

  // Deploy mocked LiquidationEngine
  const mockedLiquidationEngine = await smockit(await ethers.getContractFactory("LiquidationEngine", deployer))

  // Deploy mocked SystemDebtEngine
  const mockedSystemDebtEngine = await smockit(await ethers.getContractFactory("SystemDebtEngine", deployer))

  // Deploy mocked PriceOracle
  const mockedPriceOracle = await smockit(await ethers.getContractFactory("PriceOracle", deployer))

  // Deploy mocked PriceFeed
  const mockedPriceFeed = await smockit(await ethers.getContractFactory("MockPriceFeed", deployer))

  // Deploy ShowStopper
  const ShowStopper = (await ethers.getContractFactory("ShowStopper", deployer)) as ShowStopper__factory
  const showStopper = (await upgrades.deployProxy(ShowStopper, [])) as ShowStopper
  await showStopper.deployed()

  return {
    showStopper,
    mockedBookKeeper,
    mockedLiquidationEngine,
    mockedSystemDebtEngine,
    mockedPriceOracle,
    mockedPriceFeed,
  }
}

describe("ShowStopper", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer
  let dev: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string
  let devAddress: string

  // Contracts
  let mockedBookKeeper: MockContract
  let mockedLiquidationEngine: MockContract
  let mockedSystemDebtEngine: MockContract
  let mockedPriceOracle: MockContract
  let mockedPriceFeed: MockContract

  let showStopper: ShowStopper
  let showStopperAsAlice: ShowStopper

  const setup = async () => {
    mockedBookKeeper.smocked.cage.will.return.with()
    mockedLiquidationEngine.smocked.cage.will.return.with()
    mockedSystemDebtEngine.smocked.cage.will.return.with()
    mockedPriceOracle.smocked.cage.will.return.with()

    await showStopper.setBookKeeper(mockedBookKeeper.address)
    await showStopper.setLiquidationEngine(mockedLiquidationEngine.address)
    await showStopper.setSystemDebtEngine(mockedSystemDebtEngine.address)
    await showStopper.setPriceOracle(mockedPriceOracle.address)
    await showStopper["cage()"]()

    mockedBookKeeper.smocked.collateralPools.will.return.with([
      UnitHelpers.WeiPerWad,
      BigNumber.from(0),
      BigNumber.from(0),
      BigNumber.from(0),
      BigNumber.from(0),
    ])
    mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, BigNumber.from(0)])
    mockedPriceFeed.smocked.readPrice.will.return.with(formatBytes32BigNumber(UnitHelpers.WeiPerWad))
    mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(UnitHelpers.WeiPerRay)
    await showStopper["cage(bytes32)"](formatBytes32String("BNB"))
  }

  beforeEach(async () => {
    ;({
      showStopper,
      mockedBookKeeper,
      mockedLiquidationEngine,
      mockedSystemDebtEngine,
      mockedPriceOracle,
      mockedPriceFeed,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      dev.getAddress(),
    ])

    showStopperAsAlice = ShowStopper__factory.connect(showStopper.address, alice) as ShowStopper
  })

  describe("#cage()", () => {
    context("when setting collateral pool is inactive", () => {
      it("should be success", async () => {
        expect(await showStopper.live()).to.be.equal(1)

        mockedBookKeeper.smocked.cage.will.return.with()
        mockedLiquidationEngine.smocked.cage.will.return.with()
        mockedSystemDebtEngine.smocked.cage.will.return.with()
        mockedPriceOracle.smocked.cage.will.return.with()

        await showStopper.setBookKeeper(mockedBookKeeper.address)
        await showStopper.setLiquidationEngine(mockedLiquidationEngine.address)
        await showStopper.setSystemDebtEngine(mockedSystemDebtEngine.address)
        await showStopper.setPriceOracle(mockedPriceOracle.address)

        await expect(showStopper["cage()"]()).to.emit(showStopper, "Cage()").withArgs()

        expect(await showStopper.live()).to.be.equal(0)
      })
    })

    context("when user does not have authorized", () => {
      it("should revert", async () => {
        expect(await showStopper.live()).to.be.equal(1)

        mockedBookKeeper.smocked.cage.will.return.with()
        mockedLiquidationEngine.smocked.cage.will.return.with()
        mockedSystemDebtEngine.smocked.cage.will.return.with()
        mockedPriceOracle.smocked.cage.will.return.with()

        await showStopper.setBookKeeper(mockedBookKeeper.address)
        await showStopper.setLiquidationEngine(mockedLiquidationEngine.address)
        await showStopper.setSystemDebtEngine(mockedSystemDebtEngine.address)
        await showStopper.setPriceOracle(mockedPriceOracle.address)

        await expect(showStopperAsAlice["cage()"]()).to.be.revertedWith("!ownerRole")
      })
    })
  })

  describe("#cage(collateralPoolId)", () => {
    context("when setting collateral pool is inactive", () => {
      context("pool is inactive", () => {
        it("should be success", async () => {
          expect(await showStopper.live()).to.be.equal(1)

          mockedBookKeeper.smocked.cage.will.return.with()
          mockedLiquidationEngine.smocked.cage.will.return.with()
          mockedSystemDebtEngine.smocked.cage.will.return.with()
          mockedPriceOracle.smocked.cage.will.return.with()

          await showStopper.setBookKeeper(mockedBookKeeper.address)
          await showStopper.setLiquidationEngine(mockedLiquidationEngine.address)
          await showStopper.setSystemDebtEngine(mockedSystemDebtEngine.address)
          await showStopper.setPriceOracle(mockedPriceOracle.address)
          await showStopper["cage()"]()

          mockedBookKeeper.smocked.collateralPools.will.return.with([
            UnitHelpers.WeiPerWad,
            BigNumber.from(0),
            BigNumber.from(0),
            BigNumber.from(0),
            BigNumber.from(0),
          ])
          mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, BigNumber.from(0)])
          mockedPriceFeed.smocked.readPrice.will.return.with(formatBytes32BigNumber(UnitHelpers.WeiPerWad))
          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(UnitHelpers.WeiPerRay)

          await expect(showStopper["cage(bytes32)"](formatBytes32String("BNB")))
            .to.emit(showStopper, "Cage(bytes32)")
            .withArgs(formatBytes32String("BNB"))

          expect(await showStopper.live()).to.be.equal(0)
        })
      })

      context("pool is active", () => {
        it("should revert", async () => {
          await expect(showStopper["cage(bytes32)"](formatBytes32String("BNB"))).to.be.revertedWith(
            "ShowStopper/still-live"
          )
        })
      })

      context("cage price is already defined", () => {
        it("should be revert", async () => {
          expect(await showStopper.live()).to.be.equal(1)

          mockedBookKeeper.smocked.cage.will.return.with()
          mockedLiquidationEngine.smocked.cage.will.return.with()
          mockedSystemDebtEngine.smocked.cage.will.return.with()
          mockedPriceOracle.smocked.cage.will.return.with()

          await showStopper.setBookKeeper(mockedBookKeeper.address)
          await showStopper.setLiquidationEngine(mockedLiquidationEngine.address)
          await showStopper.setSystemDebtEngine(mockedSystemDebtEngine.address)
          await showStopper.setPriceOracle(mockedPriceOracle.address)
          await showStopper["cage()"]()

          mockedBookKeeper.smocked.collateralPools.will.return.with([
            UnitHelpers.WeiPerWad,
            BigNumber.from(0),
            BigNumber.from(0),
            BigNumber.from(0),
            BigNumber.from(0),
          ])
          mockedPriceOracle.smocked.collateralPools.will.return.with([mockedPriceFeed.address, BigNumber.from(0)])
          mockedPriceFeed.smocked.readPrice.will.return.with(formatBytes32BigNumber(UnitHelpers.WeiPerWad))
          mockedPriceOracle.smocked.stableCoinReferencePrice.will.return.with(UnitHelpers.WeiPerRay)

          await showStopper["cage(bytes32)"](formatBytes32String("BNB"))

          await expect(showStopper["cage(bytes32)"](formatBytes32String("BNB"))).to.be.revertedWith(
            "ShowStopper/cage-price-collateral-pool-id-already-defined"
          )

          expect(await showStopper.live()).to.be.equal(0)
        })
      })
    })
  })

  describe("#redeemLockedCollateral", () => {
    context("when setting collateral pool is active", () => {
      context("pool is inactive", () => {
        context("and debtShare is more than 0", () => {
          it("should revert", async () => {
            await setup()

            mockedBookKeeper.smocked.positions.will.return.with([UnitHelpers.WeiPerRay, BigNumber.from("1")])

            await expect(showStopper.redeemLockedCollateral(formatBytes32String("BNB"))).to.be.revertedWith(
              "ShowStopper/debtShare-not-zero"
            )
          })
        })

        context("and lockedCollateral is overflow (> MaxInt256)", () => {
          it("should revert", async () => {
            await setup()

            mockedBookKeeper.smocked.positions.will.return.with([ethers.constants.MaxUint256, BigNumber.from("0")])

            await expect(showStopper.redeemLockedCollateral(formatBytes32String("BNB"))).to.be.revertedWith(
              "ShowStopper/overflow"
            )
          })
        })

        context("and debtShare is 0 and lockedCollateral is 1 ray", () => {
          it("should be success", async () => {
            await setup()

            mockedBookKeeper.smocked.positions.will.return.with([UnitHelpers.WeiPerRay, BigNumber.from("0")])
            mockedBookKeeper.smocked.confiscatePosition.will.return.with()

            await expect(showStopper.redeemLockedCollateral(formatBytes32String("BNB")))
              .to.emit(showStopper, "RedeemLockedCollateral")
              .withArgs(formatBytes32String("BNB"), deployerAddress, UnitHelpers.WeiPerRay)

            const { calls: positions } = mockedBookKeeper.smocked.positions
            const { calls: confiscatePosition } = mockedBookKeeper.smocked.confiscatePosition

            expect(positions.length).to.be.equal(1)
            expect(positions[0][0]).to.be.equal(formatBytes32String("BNB"))
            expect(positions[0][1]).to.be.equal(deployerAddress)

            expect(confiscatePosition.length).to.be.equal(1)
            expect(confiscatePosition[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(confiscatePosition[0].positionAddress).to.be.equal(deployerAddress)
            expect(confiscatePosition[0].collateralCreditor).to.be.equal(deployerAddress)
            expect(confiscatePosition[0].collateralAmount).to.be.equal(UnitHelpers.WeiPerRay.mul("-1"))
          })
        })
      })

      context("pool is active", () => {
        it("should revert", async () => {
          await expect(showStopper.redeemLockedCollateral(formatBytes32String("BNB"))).to.be.revertedWith(
            "ShowStopper/still-live"
          )
        })
      })
    })
  })

  describe("#finalizeDebt", () => {
    context("when calculate debt", () => {
      context("pool is inactive", () => {
        context("debt is not 0", () => {
          it("should revert", async () => {
            await setup()

            mockedBookKeeper.smocked.totalStablecoinIssued.will.return.with(UnitHelpers.WeiPerRay)
            await showStopper.finalizeDebt()

            await expect(showStopper.finalizeDebt()).to.be.revertedWith("ShowStopper/debt-not-zero")
          })
        })

        context("stablecoin is not 0", () => {
          it("should revert", async () => {
            await setup()

            mockedBookKeeper.smocked.stablecoin.will.return.with(UnitHelpers.WeiPerRay)

            await expect(showStopper.finalizeDebt()).to.be.revertedWith("ShowStopper/surplus-not-zero")
          })
        })

        context("debt is 0 and stablecoin is 0", () => {
          it("should be sucess", async () => {
            await setup()

            mockedBookKeeper.smocked.totalStablecoinIssued.will.return.with(UnitHelpers.WeiPerRay)
            mockedBookKeeper.smocked.stablecoin.will.return.with(BigNumber.from("0"))

            await expect(showStopper.finalizeDebt()).to.emit(showStopper, "FinalizeDebt").withArgs()
          })
        })
      })

      context("pool is active", () => {
        it("should revert", async () => {
          await expect(showStopper.finalizeDebt()).to.be.revertedWith("ShowStopper/still-live")
        })
      })
    })
  })

  describe("#finalizeCashPrice", () => {
    context("when calculate cash price", () => {
      context("debt is 0", () => {
        it("should revert", async () => {
          await expect(showStopper.finalizeCashPrice(formatBytes32String("BNB"))).to.be.revertedWith(
            "ShowStopper/debt-zero"
          )
        })
      })

      context("cash price is already defined", () => {
        it("should revert", async () => {
          await setup()

          mockedBookKeeper.smocked.totalStablecoinIssued.will.return.with(UnitHelpers.WeiPerRay)
          await showStopper.finalizeDebt()

          mockedBookKeeper.smocked.collateralPools.will.return.with([
            BigNumber.from(0),
            UnitHelpers.WeiPerWad,
            BigNumber.from(0),
            BigNumber.from(0),
            BigNumber.from(0),
          ])
          await showStopper.finalizeCashPrice(formatBytes32String("BNB"))

          await expect(showStopper.finalizeCashPrice(formatBytes32String("BNB"))).to.be.revertedWith(
            "ShowStopper/final-cash-price-collateral-pool-id-already-defined"
          )
        })
      })

      context("cash price is 1 ray", () => {
        it("should be success", async () => {
          await setup()

          mockedBookKeeper.smocked.totalStablecoinIssued.will.return.with(UnitHelpers.WeiPerRay)
          await showStopper.finalizeDebt()

          mockedBookKeeper.smocked.collateralPools.will.return.with([
            BigNumber.from(0),
            UnitHelpers.WeiPerWad,
            BigNumber.from(0),
            BigNumber.from(0),
            BigNumber.from(0),
          ])

          await expect(showStopper.finalizeCashPrice(formatBytes32String("BNB")))
            .to.emit(showStopper, "FinalizeCashPrice")
            .withArgs(formatBytes32String("BNB"))

          const { calls: collateralPools } = mockedBookKeeper.smocked.collateralPools

          expect(collateralPools.length).to.be.equal(1)
          expect(collateralPools[0][0]).to.be.equal(formatBytes32String("BNB"))
        })
      })
    })
  })

  describe("#accumulateStablecoin", () => {
    context("when moving stable coin", () => {
      context("debt is 0", () => {
        it("should revert", async () => {
          await expect(showStopper.accumulateStablecoin(UnitHelpers.WeiPerRay)).to.be.revertedWith(
            "ShowStopper/debt-zero"
          )
        })
      })

      context("debt is not 0", () => {
        it("should be success", async () => {
          await setup()

          mockedBookKeeper.smocked.totalStablecoinIssued.will.return.with(UnitHelpers.WeiPerRay)
          await showStopper.finalizeDebt()

          mockedBookKeeper.smocked.moveStablecoin.will.return.with()

          await expect(showStopper.accumulateStablecoin(UnitHelpers.WeiPerWad))
            .to.emit(showStopper, "AccumulateStablecoin")
            .withArgs(deployerAddress, UnitHelpers.WeiPerWad)
        })
      })
    })
  })

  describe("#redeemStablecoin", () => {
    context("when calculate cash", () => {
      context("cash price is not defined", () => {
        it("should revert", async () => {
          await expect(
            showStopper.redeemStablecoin(formatBytes32String("BNB"), UnitHelpers.WeiPerWad)
          ).to.be.revertedWith("ShowStopper/final-cash-price-collateral-pool-id-not-defined")
        })
      })

      context("cash price is already defined", () => {
        context("and stablecoinAccumulator balance < withdraw", () => {
          it("should revert", async () => {
            await setup()

            mockedBookKeeper.smocked.totalStablecoinIssued.will.return.with(UnitHelpers.WeiPerRay)
            await showStopper.finalizeDebt()

            mockedBookKeeper.smocked.collateralPools.will.return.with([
              BigNumber.from(0),
              UnitHelpers.WeiPerWad,
              BigNumber.from(0),
              BigNumber.from(0),
              BigNumber.from(0),
            ])

            await showStopper.finalizeCashPrice(formatBytes32String("BNB"))

            mockedBookKeeper.smocked.moveStablecoin.will.return.with()

            await expect(
              showStopper.redeemStablecoin(formatBytes32String("BNB"), UnitHelpers.WeiPerWad)
            ).to.be.revertedWith("ShowStopper/insufficient-stablecoin-accumulator-balance")
          })
        })

        context("and stablecoinAccumulator balance = withdraw", () => {
          it("should be success", async () => {
            await setup()

            mockedBookKeeper.smocked.totalStablecoinIssued.will.return.with(UnitHelpers.WeiPerRay)
            await showStopper.finalizeDebt()

            mockedBookKeeper.smocked.collateralPools.will.return.with([
              BigNumber.from(0),
              UnitHelpers.WeiPerWad,
              BigNumber.from(0),
              BigNumber.from(0),
              BigNumber.from(0),
            ])

            await showStopper.finalizeCashPrice(formatBytes32String("BNB"))

            await showStopper.accumulateStablecoin(UnitHelpers.WeiPerWad)

            mockedBookKeeper.smocked.moveCollateral.will.return.with()

            await expect(showStopper.redeemStablecoin(formatBytes32String("BNB"), UnitHelpers.WeiPerWad))
              .to.emit(showStopper, "RedeemStablecoin")
              .withArgs(formatBytes32String("BNB"), deployerAddress, UnitHelpers.WeiPerWad)

            const { calls: moveCollateral } = mockedBookKeeper.smocked.moveCollateral

            expect(moveCollateral.length).to.be.equal(1)
            expect(moveCollateral[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(moveCollateral[0].src).to.be.equal(showStopper.address)
            expect(moveCollateral[0].dst).to.be.equal(deployerAddress)
            expect(moveCollateral[0].amount).to.be.equal(UnitHelpers.WeiPerRay)
          })
        })

        context("and stablecoinAccumulator balance > withdraw", () => {
          it("should be success", async () => {
            await setup()

            mockedBookKeeper.smocked.totalStablecoinIssued.will.return.with(UnitHelpers.WeiPerRay)
            await showStopper.finalizeDebt()

            mockedBookKeeper.smocked.collateralPools.will.return.with([
              BigNumber.from(0),
              UnitHelpers.WeiPerWad,
              BigNumber.from(0),
              BigNumber.from(0),
              BigNumber.from(0),
            ])

            await showStopper.finalizeCashPrice(formatBytes32String("BNB"))

            await showStopper.accumulateStablecoin(UnitHelpers.WeiPerWad.mul(2))

            mockedBookKeeper.smocked.moveCollateral.will.return.with()

            await expect(showStopper.redeemStablecoin(formatBytes32String("BNB"), UnitHelpers.WeiPerWad))
              .to.emit(showStopper, "RedeemStablecoin")
              .withArgs(formatBytes32String("BNB"), deployerAddress, UnitHelpers.WeiPerWad)

            const { calls: moveCollateral } = mockedBookKeeper.smocked.moveCollateral

            expect(moveCollateral.length).to.be.equal(1)
            expect(moveCollateral[0].collateralPoolId).to.be.equal(formatBytes32String("BNB"))
            expect(moveCollateral[0].src).to.be.equal(showStopper.address)
            expect(moveCollateral[0].dst).to.be.equal(deployerAddress)
            expect(moveCollateral[0].amount).to.be.equal(UnitHelpers.WeiPerRay)
          })
        })
      })
    })
  })

  describe("#setBookKeeper", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(showStopperAsAlice.setBookKeeper(mockedBookKeeper.address)).to.be.revertedWith("!ownerRole")
      })
    })
    context("when the caller is the owner", async () => {
      context("when showStopper does not live", () => {
        it("should be revert", async () => {
          // grant role access
          await showStopper.grantRole(await showStopper.OWNER_ROLE(), deployerAddress)

          await setup()

          await expect(showStopper.setBookKeeper(mockedBookKeeper.address)).to.be.revertedWith("ShowStopper/not-live")
        })
      })
      context("when showStopper is live", () => {
        it("should be able to call setBookKeeper", async () => {
          // grant role access
          await showStopper.grantRole(await showStopper.OWNER_ROLE(), deployerAddress)
          // set total debt ceiling 1 rad
          await expect(showStopper.setBookKeeper(mockedBookKeeper.address))
            .to.emit(showStopper, "SetBookKeeper")
            .withArgs(deployerAddress, mockedBookKeeper.address)
        })
      })
    })
  })

  describe("#setLiquidationEngine", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(showStopperAsAlice.setLiquidationEngine(mockedLiquidationEngine.address)).to.be.revertedWith(
          "!ownerRole"
        )
      })
    })
    context("when the caller is the owner", async () => {
      context("when showStopper does not live", () => {
        it("should be revert", async () => {
          // grant role access
          await showStopper.grantRole(await showStopper.OWNER_ROLE(), deployerAddress)

          await setup()

          await expect(showStopper.setLiquidationEngine(mockedLiquidationEngine.address)).to.be.revertedWith(
            "ShowStopper/not-live"
          )
        })
      })
      context("when showStopper is live", () => {
        it("should be able to call setLiquidationEngine", async () => {
          // grant role access
          await showStopper.grantRole(await showStopper.OWNER_ROLE(), deployerAddress)
          // set total debt ceiling 1 rad
          await expect(showStopper.setLiquidationEngine(mockedLiquidationEngine.address))
            .to.emit(showStopper, "SetLiquidationEngine")
            .withArgs(deployerAddress, mockedLiquidationEngine.address)
        })
      })
    })
  })

  describe("#setSystemDebtEngine", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(showStopperAsAlice.setSystemDebtEngine(mockedSystemDebtEngine.address)).to.be.revertedWith(
          "!ownerRole"
        )
      })
    })
    context("when the caller is the owner", async () => {
      context("when showStopper does not live", () => {
        it("should be revert", async () => {
          // grant role access
          await showStopper.grantRole(await showStopper.OWNER_ROLE(), deployerAddress)

          await setup()

          await expect(showStopper.setSystemDebtEngine(mockedSystemDebtEngine.address)).to.be.revertedWith(
            "ShowStopper/not-live"
          )
        })
      })
      context("when showStopper is live", () => {
        it("should be able to call setSystemDebtEngine", async () => {
          // grant role access
          await showStopper.grantRole(await showStopper.OWNER_ROLE(), deployerAddress)
          // set total debt ceiling 1 rad
          await expect(showStopper.setSystemDebtEngine(mockedSystemDebtEngine.address))
            .to.emit(showStopper, "SetSystemDebtEngine")
            .withArgs(deployerAddress, mockedSystemDebtEngine.address)
        })
      })
    })
  })

  describe("#setPriceOracle", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(showStopperAsAlice.setPriceOracle(mockedPriceOracle.address)).to.be.revertedWith("!ownerRole")
      })
    })
    context("when the caller is the owner", async () => {
      context("when showStopper does not live", () => {
        it("should be revert", async () => {
          // grant role access
          await showStopper.grantRole(await showStopper.OWNER_ROLE(), deployerAddress)

          await setup()

          await expect(showStopper.setPriceOracle(mockedPriceOracle.address)).to.be.revertedWith("ShowStopper/not-live")
        })
      })
      context("when showStopper is live", () => {
        it("should be able to call setPriceOracle", async () => {
          // grant role access
          await showStopper.grantRole(await showStopper.OWNER_ROLE(), deployerAddress)
          // set total debt ceiling 1 rad
          await expect(showStopper.setPriceOracle(mockedPriceOracle.address))
            .to.emit(showStopper, "SetPriceOracle")
            .withArgs(deployerAddress, mockedPriceOracle.address)
        })
      })
    })
  })
})
