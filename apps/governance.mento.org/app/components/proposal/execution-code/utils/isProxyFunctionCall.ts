import type { Abi } from "viem";

/**
 * Check if a function selector matches a proxy function
 */
export function isProxyFunctionCall(
  functionSelector: string,
  proxyABI?: Abi,
): boolean {
  if (!proxyABI) return false;

  // Common proxy function selectors
  const proxyFunctionSelectors = [
    "0x3659cfe6", // upgrade(address)
    "0x4f1ef286", // upgradeTo(address)
    "0x4f1ef286", // upgradeToAndCall(address,bytes)
    "0x8f283970", // changeAdmin(address)
    "0xf851a440", // admin()
    "0x5c60da1b", // implementation()
    "0x5c60da1b", // _getImplementation()
    "0x8da5cb5b", // _getOwner()
    "0x715018a6", // _transferOwnership(address)
    "0x55f804b3", // _setImplementation(address)
    "0x4e1273f4", // _setAndInitializeImplementation(address,bytes)
  ];

  // Check if it's a known proxy function
  if (proxyFunctionSelectors.includes(functionSelector)) {
    return true;
  }

  return false;
}
