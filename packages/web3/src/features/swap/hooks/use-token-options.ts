import { Celo } from "@/config/chains";
import { getSwappableTokenOptions, TokenWithBalance } from "@/config/tokens";
import { AccountBalances } from "@/features/accounts";
import { useSDKTokens } from "@/features/tokens/use-sdk-tokens";
import { logger } from "@/utils/logger";
import { TokenSymbol } from "@mento-protocol/mento-sdk";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

export function useTokenOptions(
  tokenInSymbol?: TokenSymbol,
  balancesFromHook?: AccountBalances,
) {
  const { chain } = useAccount();
  const chainId = useMemo(() => chain?.id ?? Celo.id, [chain]);
  const [swappableTokens, setSwappableTokens] = useState<TokenSymbol[]>([]);

  // Get cached tokens synchronously from SDK
  const tokens = useSDKTokens();
  const isLoading = Object.keys(tokens).length === 0;

  // Get all available token IDs from SDK
  const allTokenSymbols = useMemo(() => {
    if (!tokens) return [];
    return Object.keys(tokens) as TokenSymbol[];
  }, [tokens]);

  // Map all token IDs to token options with additional data
  const allTokenOptions = useMemo<TokenWithBalance[]>(() => {
    if (!tokens) return [];

    return allTokenSymbols
      .map((symbol) => {
        const token = tokens[symbol];
        if (!token) return null;

        return {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          balance: balancesFromHook?.[symbol] || "0",
        };
      })
      .filter(
        (option): option is NonNullable<typeof option> => option !== null,
      );
  }, [tokens, allTokenSymbols, balancesFromHook]);

  // Get tokens that can be swapped with selected token
  useEffect(() => {
    const fetchSwappableTokens = async () => {
      if (!tokenInSymbol) return;

      const tokens = await getSwappableTokenOptions(tokenInSymbol, chainId);
      setSwappableTokens(tokens);
    };

    fetchSwappableTokens().catch(logger.error);
  }, [chainId, tokenInSymbol]);

  // Map swappable token IDs to token options with additional data
  const swappableTokenOptions = useMemo<TokenWithBalance[]>(() => {
    if (!tokens) return [];

    return swappableTokens
      .map((id) => {
        const token = tokens[id];
        if (!token) return null;

        return {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          balance: balancesFromHook?.[id] || "0",
          decimals: token.decimals,
        };
      })
      .filter(
        (option): option is NonNullable<typeof option> => option !== null,
      );
  }, [swappableTokens, balancesFromHook, tokens]);

  return {
    allTokenOptions,
    swappableTokens,
    tokenOptions: swappableTokenOptions,
    isLoading,
  };
}
