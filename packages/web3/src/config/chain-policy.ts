import { ChainId } from "./chains";

export type AppFeature =
  | "swap"
  | "pools"
  | "stabilityPool"
  | "borrow"
  | "bridge"
  | "rewards";

export const ALL_CHAIN_IDS = [
  ChainId.Celo,
  ChainId.CeloSepolia,
  ChainId.Monad,
  ChainId.MonadTestnet,
] as const satisfies readonly ChainId[];

export const MAINNET_CHAIN_IDS = [
  ChainId.Celo,
  ChainId.Monad,
] as const satisfies readonly ChainId[];

export const TESTNET_CHAIN_IDS = [
  ChainId.CeloSepolia,
  ChainId.MonadTestnet,
] as const satisfies readonly ChainId[];

const FEATURE_CHAIN_IDS: Record<AppFeature, readonly ChainId[]> = {
  swap: ALL_CHAIN_IDS,
  pools: ALL_CHAIN_IDS,
  stabilityPool: [ChainId.Celo, ChainId.CeloSepolia],
  borrow: [ChainId.Celo, ChainId.CeloSepolia],
  bridge: [ChainId.Celo, ChainId.Monad],
  rewards: [ChainId.Celo, ChainId.Monad],
};

const TESTNET_TO_MAINNET: Partial<Record<ChainId, ChainId>> = {
  [ChainId.CeloSepolia]: ChainId.Celo,
  [ChainId.MonadTestnet]: ChainId.Monad,
};

export function isTestnetChain(chainId?: number): boolean {
  return TESTNET_CHAIN_IDS.includes(
    chainId as (typeof TESTNET_CHAIN_IDS)[number],
  );
}

export function getMainnetFallbackChainId(
  chainId?: number,
): ChainId | undefined {
  if (chainId == null) return undefined;
  return TESTNET_TO_MAINNET[chainId as ChainId] ?? (chainId as ChainId);
}

export function isFeatureConfiguredOnChain({
  chainId,
  feature,
}: {
  chainId?: number;
  feature: AppFeature;
}): boolean {
  if (chainId == null) return false;
  return FEATURE_CHAIN_IDS[feature].includes(chainId as ChainId);
}

export function isFeatureSupported({
  chainId,
  feature,
  testnetMode,
}: {
  chainId?: number;
  feature: AppFeature;
  testnetMode: boolean;
}): boolean {
  if (!isFeatureConfiguredOnChain({ chainId, feature })) {
    return false;
  }

  return testnetMode || !isTestnetChain(chainId);
}

export function isChainVisible({
  chainId,
  testnetMode,
  feature,
}: {
  chainId?: number;
  testnetMode: boolean;
  feature?: AppFeature;
}): boolean {
  if (chainId == null) return false;
  if (feature && !isFeatureConfiguredOnChain({ chainId, feature })) {
    return false;
  }

  return testnetMode || !isTestnetChain(chainId);
}

export function getVisibleChains({
  testnetMode,
  feature,
}: {
  testnetMode: boolean;
  feature?: AppFeature;
}): ChainId[] {
  return ALL_CHAIN_IDS.filter((chainId) =>
    isChainVisible({ chainId, testnetMode, feature }),
  );
}

export function getPreferredVisibleChain({
  testnetMode,
  feature,
  chainId,
  fallbackChainId,
}: {
  testnetMode: boolean;
  feature?: AppFeature;
  chainId?: number;
  fallbackChainId?: ChainId;
}): ChainId {
  if (isChainVisible({ chainId, testnetMode, feature })) {
    return chainId as ChainId;
  }

  const mainnetFallback = getMainnetFallbackChainId(chainId);
  if (isChainVisible({ chainId: mainnetFallback, testnetMode, feature })) {
    return mainnetFallback as ChainId;
  }

  if (isChainVisible({ chainId: fallbackChainId, testnetMode, feature })) {
    return fallbackChainId as ChainId;
  }

  return getVisibleChains({ testnetMode, feature })[0] ?? ChainId.Celo;
}
