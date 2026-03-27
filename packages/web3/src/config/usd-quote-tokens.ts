import {
  TOKEN_ADDRESSES_BY_CHAIN,
  TokenSymbol,
} from "@mento-protocol/mento-sdk";
import type { ChainId } from "./chains";

const MONAD_CHAIN_ID = 143 as ChainId;
const MONAD_TESTNET_CHAIN_ID = 10143 as ChainId;

const USD_QUOTE_TOKEN_SYMBOLS = [
  TokenSymbol.USDm,
  TokenSymbol.USDC,
  TokenSymbol.USD_,
  TokenSymbol.axlUSDC,
  TokenSymbol.AUSD,
] as const;

const USD_QUOTE_TOKEN_PREFERENCE_BY_CHAIN: Partial<
  Record<ChainId, readonly TokenSymbol[]>
> = {
  [MONAD_CHAIN_ID]: [TokenSymbol.USDC, TokenSymbol.AUSD, TokenSymbol.USDm],
  [MONAD_TESTNET_CHAIN_ID]: [
    TokenSymbol.USDC,
    TokenSymbol.AUSD,
    TokenSymbol.USDm,
  ],
};

const USD_QUOTE_TOKEN_SYMBOL_SET = new Set<TokenSymbol>(
  USD_QUOTE_TOKEN_SYMBOLS,
);

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

const USD_QUOTE_TOKEN_ADDRESSES_BY_CHAIN: Partial<
  Record<ChainId, ReadonlySet<string>>
> = Object.fromEntries(
  Object.entries(TOKEN_ADDRESSES_BY_CHAIN).map(([chainId, tokenAddresses]) => [
    Number(chainId),
    new Set(
      USD_QUOTE_TOKEN_SYMBOLS.flatMap((symbol) => {
        const tokenAddress = tokenAddresses?.[symbol];
        return tokenAddress ? [normalizeAddress(tokenAddress)] : [];
      }),
    ),
  ]),
) as Partial<Record<ChainId, ReadonlySet<string>>>;

export function isUsdQuoteTokenAddress(
  tokenAddress: string,
  chainId: ChainId,
): boolean {
  const addresses = USD_QUOTE_TOKEN_ADDRESSES_BY_CHAIN[chainId];
  return addresses?.has(normalizeAddress(tokenAddress)) ?? false;
}

export function isUsdQuoteTokenSymbol(tokenSymbol: TokenSymbol): boolean {
  return USD_QUOTE_TOKEN_SYMBOL_SET.has(tokenSymbol);
}

export function getPreferredUsdQuoteTokenSymbol(
  chainId: number,
): TokenSymbol | null {
  const tokenAddresses = TOKEN_ADDRESSES_BY_CHAIN[chainId as ChainId];
  if (!tokenAddresses) return null;

  const preferredSymbols =
    USD_QUOTE_TOKEN_PREFERENCE_BY_CHAIN[chainId as ChainId] ??
    USD_QUOTE_TOKEN_SYMBOLS;

  for (const symbol of preferredSymbols) {
    if (tokenAddresses[symbol]) {
      return symbol;
    }
  }

  return null;
}
