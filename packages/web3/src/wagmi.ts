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
  useBlock,
  useBlockNumber,
  useChains,
  useChainId,
  useDisconnect,
  useReadContracts,
  useSimulateContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
  useReadContract,
  useClient,
  useConfig,
  type State,
} from "wagmi";

// RainbowKit hooks
export { useConnectModal } from "@rainbow-me/rainbowkit";

// Action utilities that are not exported by the core package
export {
  waitForTransaction,
  waitForTransactionReceipt,
  type WriteContractErrorType,
} from "wagmi/actions";
