pragma solidity 0.6.12;

// ProxyWalletCache
// This global cache stores addresses of contracts previously deployed
// by a proxy. This saves gas from repeat deployment of the same
// contracts and eliminates blockchain bloat.

// By default, all proxies deployed from the same factory store
// contracts in the same cache. The cache a proxy instance uses can be
// changed.  The cache uses the sha3 hash of a contract's bytecode to
// lookup the address
contract ProxyWalletCache {
  mapping(bytes32 => address) cache;

  function read(bytes memory _code) public view returns (address) {
    bytes32 hash = keccak256(_code);
    return cache[hash];
  }

  function write(bytes memory _code) public returns (address _target) {
    assembly {
      _target := create(0, add(_code, 0x20), mload(_code))
      switch iszero(extcodesize(_target))
      case 1 {
        // throw if contract failed to deploy
        revert(0, 0)
      }
    }
    bytes32 hash = keccak256(_code);
    cache[hash] = _target;
  }
}
