import chai from "chai"
import { BigNumber, BigNumberish } from "ethers"

const { expect } = chai

export function assertAlmostEqual(expected: BigNumberish, actual: BigNumberish) {
  const expectedBN = BigNumber.from(expected)
  const actualBN = BigNumber.from(actual)
  const diffBN = expectedBN.gt(actualBN) ? expectedBN.sub(actualBN) : actualBN.sub(expectedBN)
  const tolerance = expectedBN.div(BigNumber.from("10000"))
  return expect(diffBN, `${actual} is not almost eqaual to ${expected}`).to.be.lte(tolerance)
}
