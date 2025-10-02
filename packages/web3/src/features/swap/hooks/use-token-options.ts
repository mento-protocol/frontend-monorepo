import { Celo } from "@/config/chains";
import { getSwappableTokenOptions } from "@/config/tokens";
import { logger } from "@/utils/logger";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useSDKTokens } from "@/features/tokens/use-sdk-tokens";

export interface TokenOption {
  id: string;
  symbol: string;
  name: string;
  balance: string;
  decimals?: number;
}

export function useTokenOptions(
  tokenInId?: string,
  balancesFromHook?: Record<string, string>,
) {
  const { chain } = useAccount();
  const chainId = useMemo(() => chain?.id ?? Celo.id, [chain]);
  const [swappableTokens, setSwappableTokens] = useState<string[]>([]);

  // Get cached tokens synchronously from SDK
  const sdkTokens = useSDKTokens();
  const isLoading = Object.keys(sdkTokens).length === 0;

  // Get all available token IDs from SDK
  const allTokenIds = useMemo(() => {
    if (!sdkTokens) return [];
    return Object.keys(sdkTokens);
  }, [sdkTokens]);

  // Map all token IDs to token options with additional data
  const allTokenOptions = useMemo(() => {
    if (!sdkTokens) return [];

    return allTokenIds
      .map((id) => {
        const sdkToken = sdkTokens[id];
        if (!sdkToken) return null;

        return {
          id,
          symbol: sdkToken.symbol,
          name: sdkToken.name,
          balance: balancesFromHook?.[id] || "0",
          decimals: sdkToken.decimals,
        };
      })
      .filter(
        (option): option is NonNullable<typeof option> => option !== null,
      );
  }, [sdkTokens, allTokenIds, balancesFromHook]);

  // Get tokens that can be swapped with selected token
  useEffect(() => {
    const fetchSwappableTokens = async () => {
      if (!tokenInId) return;

      const tokens = await getSwappableTokenOptions(tokenInId, chainId);
      setSwappableTokens(tokens);
    };

    fetchSwappableTokens().catch(logger.error);
  }, [chainId, tokenInId]);

  // Map swappable token IDs to token options with additional data
  const swappableTokenOptions = useMemo(() => {
    if (!sdkTokens) return [];

    return swappableTokens
      .map((id) => {
        const sdkToken = sdkTokens[id];
        if (!sdkToken) return null;

        return {
          id,
          symbol: sdkToken.symbol,
          name: sdkToken.name,
          balance: balancesFromHook?.[id] || "0",
          decimals: sdkToken.decimals,
        };
      })
      .filter(
        (option): option is NonNullable<typeof option> => option !== null,
      );
  }, [swappableTokens, balancesFromHook, sdkTokens]);

  return {
    allTokenOptions,
    swappableTokens,
    tokenOptions: swappableTokenOptions,
    isLoading,
  };
}
