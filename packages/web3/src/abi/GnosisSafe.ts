/**
 * Minimal Gnosis Safe ABI for watchdog functionality.
 * Only includes methods needed to check Safe ownership.
 */
export const GnosisSafeABI = [
  {
    inputs: [],
    name: "getOwners",
    outputs: [{ internalType: "address[]", name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
