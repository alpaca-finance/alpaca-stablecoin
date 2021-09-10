pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";

library UintArrayUtil {
  using SafeMath for uint256;

  function swap(
    uint256[] memory array,
    uint256 i,
    uint256 j
  ) internal pure {
    (array[i], array[j]) = (array[j], array[i]);
  }

  function sort(
    uint256[] memory array,
    uint256 begin,
    uint256 end
  ) internal pure {
    if (begin < end) {
      uint256 j = begin;
      uint256 pivot = array[j];
      for (uint256 i = begin + 1; i < end; ++i) {
        if (array[i] < pivot) {
          swap(array, i, ++j);
        }
      }
      swap(array, begin, j);
      sort(array, begin, j);
      sort(array, j + 1, end);
    }
  }

  function median(uint256[] memory array, uint256 length) internal pure returns (uint256) {
    sort(array, 0, length);

    // average of two elem
    if (length % 2 == 0) {
      return array[length / 2 - 1].add(array[length / 2]) / 2;
    }

    // the mid elem
    return array[length / 2];
  }
}
