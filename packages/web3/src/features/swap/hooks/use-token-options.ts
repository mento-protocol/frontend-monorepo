import { useEffect, useMemo, useState } from "react";
import { Celo } from "@/config/chains";
import {
  type TokenId,
  getSwappableTokenOptions,
  getTokenOptionsByChainId,
  getTokenById,
} from "@/config/tokens";
import { logger } from "@/utils/logger";
import { useNetwork } from "wagmi";

export interface TokenOption {
  id: TokenId;
  symbol: string;
  name: string;
  balance: string;
  color?: string;
  decimals?: number;
}

export function useTokenOptions(
  fromTokenId?: TokenId,
  balancesFromHook?: Record<TokenId, string>,
) {
  const { chain } = useNetwork();
  const chainId = useMemo(() => chain?.id ?? Celo.chainId, [chain]);
  const [swappableTokens, setSwappableTokens] = useState<TokenId[]>([]);

  // Get all available tokens for current chain
  const allTokenIds = useMemo(() => {
    return getTokenOptionsByChainId(chainId);
  }, [chainId]);

  // Map all token IDs to token options with additional data
  const allTokenOptions = useMemo(() => {
    return allTokenIds.map((id) => {
      const token = getTokenById(id);
      return {
        id,
        symbol: token.symbol,
        name: token.name,
        balance: balancesFromHook?.[id] || "0",
        color: token.color,
        decimals: token.decimals,
      };
    });
  }, [allTokenIds, balancesFromHook]);

  // Get tokens that can be swapped with selected token
  useEffect(() => {
    const fetchSwappableTokens = async () => {
      if (!fromTokenId) return;

      const tokens = await getSwappableTokenOptions(fromTokenId, chainId);
      setSwappableTokens(tokens);
    };

    fetchSwappableTokens().catch(logger.error);
  }, [chainId, fromTokenId]);

  // Map swappable token IDs to token options with additional data
  const swappableTokenOptions = useMemo(() => {
    return swappableTokens.map((id) => {
      const token = getTokenById(id);
      return {
        id,
        symbol: token.symbol,
        name: token.name,
        balance: balancesFromHook?.[id] || "0",
        color: token.color,
        decimals: token.decimals,
      };
    });
  }, [swappableTokens, balancesFromHook]);

  return {
    allTokenOptions,
    swappableTokens,
    tokenOptions: swappableTokenOptions,
  };
}
