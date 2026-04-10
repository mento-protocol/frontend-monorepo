import { borrowRegistries } from "@mento-protocol/mento-sdk";
import {
  DEBT_TOKEN_CONFIGS,
  getDebtTokenConfig,
  type DebtTokenConfig,
} from "./debt-token-config";

export type StabilityChainId = 42220 | 11142220;

const DEFAULT_CHAIN_SLUG = "celo";
const CELO_CHAIN_ID = 42220 as const;
const CELO_SEPOLIA_CHAIN_ID = 11142220 as const;

const STABILITY_CHAINS = {
  [CELO_CHAIN_ID]: {
    name: "Celo",
    slug: "celo",
    isTestnet: false,
    fallbackChainId: CELO_CHAIN_ID,
  },
  [CELO_SEPOLIA_CHAIN_ID]: {
    name: "Celo Sepolia Testnet",
    slug: "celo-sepolia",
    isTestnet: true,
    fallbackChainId: CELO_CHAIN_ID,
  },
} as const satisfies Record<
  StabilityChainId,
  {
    name: string;
    slug: string;
    isTestnet: boolean;
    fallbackChainId: StabilityChainId;
  }
>;

export const DEFAULT_STABILITY_CHAIN_ID = CELO_CHAIN_ID;

function parseStoredBoolean(value?: string | null): boolean | null {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

function readCookieValue(
  cookieSource: string | null | undefined,
  key: string,
): string | null {
  if (!cookieSource) return null;

  const prefix = `${key}=`;
  const match = cookieSource
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  return match ? match.slice(prefix.length) : null;
}

export function readTestnetModeCookie(cookieSource?: string | null): boolean {
  return (
    parseStoredBoolean(readCookieValue(cookieSource, "mento_testnet_mode")) ??
    false
  );
}

export function resolveStabilityChainId(
  chainSlug: string,
): StabilityChainId | undefined {
  const normalizedSlug = chainSlug.toLowerCase();
  const matchingChainEntry = Object.entries(STABILITY_CHAINS).find(
    ([, chain]) => chain.slug === normalizedSlug,
  );

  return matchingChainEntry
    ? (Number(matchingChainEntry[0]) as StabilityChainId)
    : undefined;
}

export function getStabilityChainName(chainId: number): string | undefined {
  return STABILITY_CHAINS[chainId as StabilityChainId]?.name;
}

export function isStabilityChainVisible(
  chainId: number,
  testnetMode: boolean,
): chainId is StabilityChainId {
  const chain = STABILITY_CHAINS[chainId as StabilityChainId];
  if (!chain) return false;

  return testnetMode || !chain.isTestnet;
}

export function getStabilityFallbackChainId(
  chainId: number,
): StabilityChainId | undefined {
  return STABILITY_CHAINS[chainId as StabilityChainId]?.fallbackChainId;
}

export function getSupportedDebtTokens(chainId: number): DebtTokenConfig[] {
  return Object.keys(borrowRegistries[chainId] ?? {})
    .sort((a, b) => a.localeCompare(b))
    .map((symbol) => getDebtTokenConfig(symbol));
}

export function getSupportedDeployments(): Array<{
  chainId: StabilityChainId;
  token: DebtTokenConfig;
}> {
  return (
    Object.keys(STABILITY_CHAINS) as unknown as StabilityChainId[]
  ).flatMap((chainId) =>
    getSupportedDebtTokens(chainId).map((token) => ({ chainId, token })),
  );
}

export function getSupportedCollaterals(
  chainId: number,
  symbol?: string,
): string[] {
  const debtToken =
    (symbol
      ? getSupportedDebtTokens(chainId).find((token) => token.symbol === symbol)
      : undefined) ?? DEBT_TOKEN_CONFIGS.GBPm;
  return [debtToken?.collateralSymbol ?? "USDm"];
}

export function resolveStabilityDebtToken(
  tokenSlug: string,
  chainId?: number,
): DebtTokenConfig | undefined {
  const tokens = chainId
    ? getSupportedDebtTokens(chainId)
    : Array.from(
        new Map(
          getSupportedDeployments().map(({ token }) => [token.symbol, token]),
        ).values(),
      );
  return tokens.find(
    (token) => token.symbol.toLowerCase() === tokenSlug.toLowerCase(),
  );
}

export const DEFAULT_STABILITY_TOKEN =
  getSupportedDebtTokens(DEFAULT_STABILITY_CHAIN_ID)[0] ??
  getDebtTokenConfig("GBPm");

function chainIdToSlug(chainId: number): string | undefined {
  return STABILITY_CHAINS[chainId as StabilityChainId]?.slug;
}

export function getStabilityRoute(
  symbol: string,
  chainId: number = DEFAULT_STABILITY_CHAIN_ID,
): string {
  const chainSlug =
    chainIdToSlug(chainId) ??
    chainIdToSlug(DEFAULT_STABILITY_CHAIN_ID) ??
    DEFAULT_CHAIN_SLUG;
  return `/earn/stability/${chainSlug}/${symbol.toLowerCase()}`;
}

export function getStabilitySwapRoute(
  symbol: string,
  chainId: number = DEFAULT_STABILITY_CHAIN_ID,
): string {
  const params = new URLSearchParams({
    from: "USDm",
    to: symbol,
  });

  const chainSlug =
    chainIdToSlug(chainId) ??
    chainIdToSlug(DEFAULT_STABILITY_CHAIN_ID) ??
    DEFAULT_CHAIN_SLUG;
  return `/swap/${chainSlug}?${params.toString()}`;
}
