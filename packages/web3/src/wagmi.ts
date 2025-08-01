// Centralized re-exports for the subset of Wagmi helpers we use across the monorepo.
// ‑ We explicitly list each symbol to avoid duplicate exports between
//   "wagmi" and "wagmi/actions", which was triggering ambiguous namespace
//   resolution warnings in the build.
// ‑ Feel free to extend this list as new helpers are required.

// Core Wagmi hooks & utilities
export {
  cookieToInitialState,
  createStorage,
  useAccount,
  useBlockNumber,
  useChains,
  useChainId,
  useDisconnect,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
  useReadContract,
  useClient,
  useConfig,
  type State,
} from "wagmi";

// Action utilities that are not exported by the core package
export { waitForTransaction } from "wagmi/actions";
