import { useQuery } from "@tanstack/react-query";
import { Contract } from "ethers";
import { BALANCE_STALE_TIME } from "@/lib/config/consts";
import {
  type TokenId,
  getTokenAddress,
  getTokenOptionsByChainId,
} from "@/lib/config/tokens";
import { getProvider } from "@/features/providers";
import { validateAddress } from "@/lib/utils/addresses";
import { logger } from "@/lib/utils/logger";
import { erc20ABI } from "wagmi";

export type AccountBalances = Record<TokenId, string>;

interface UseAccountBalancesParams {
  address?: string;
  chainId?: number;
}

// Adapted from the original fetch-balances.ts
async function getTokenBalance({
  address,
  chainId,
  tokenSymbol,
}: {
  address: string;
  chainId: number;
  tokenSymbol: TokenId;
}): Promise<string> {
  // Return type changed to Promise<string>
  const tokenAddress = getTokenAddress(tokenSymbol, chainId);
  const provider = getProvider(chainId);
  try {
    const tokenContract = new Contract(tokenAddress, erc20ABI, provider);
    return (await tokenContract.balanceOf(address)).toString();
  } catch (error) {
    logger.error(
      `Error on getting balance of '${tokenSymbol}' token. Address: ${address}, ChainId: ${chainId}`,
      {
        error,
      },
    );
    // Re-throw to let React Query handle the error for this specific query part if needed,
    // or return a default/error indicator string if you want to show partial success.
    // For now, re-throwing to make it clear that this specific token balance fetch failed.
    // _fetchAccountBalances will handle this with Promise.allSettled.
    throw new Error(`Failed to fetch balance for ${tokenSymbol}`);
  }
}

// Adapted from the original fetch-balances.ts
async function _fetchAccountBalances(
  address: string,
  chainId: number,
): Promise<AccountBalances> {
  validateAddress(address, "_fetchAccountBalancesRQ"); // Renamed for clarity
  const tokenBalances: Partial<Record<TokenId, string>> = {};
  const tokenOptions = getTokenOptionsByChainId(chainId);

  const balancePromises = tokenOptions.map(async (tokenSymbol) => {
    const balance = await getTokenBalance({ address, chainId, tokenSymbol });
    return { tokenSymbol, balance };
  });

  const results = await Promise.allSettled(balancePromises);

  tokenOptions.forEach((tokenSymbol, index) => {
    const result = results[index];
    if (result.status === "fulfilled") {
      tokenBalances[tokenSymbol] = result.value.balance;
    } else {
      // Log individual token fetch errors but don't let one fail all others.
      // Set to '0' or an error marker if you want to indicate failure for that specific token.
      logger.warn(
        `Failed to fetch balance for token: ${tokenSymbol}. Setting to '0'. Reason:`,
        result.reason,
      );
      tokenBalances[tokenSymbol] = "0"; // Default to '0' on error for a specific token
    }
  });

  return tokenBalances as AccountBalances;
}

export function useAccountBalances({
  address,
  chainId,
}: UseAccountBalancesParams) {
  return useQuery<AccountBalances, Error>(
    ["accountBalances", { address, chainId }],
    async () => {
      if (!address || !chainId) {
        // This should ideally not be reached if `enabled` is used correctly.
        // Return an empty object or throw, depending on how you want to handle.
        // For consistency, let's return an "empty" state of balances.
        const emptyBalances: AccountBalances = {} as AccountBalances;
        for (const id of getTokenOptionsByChainId(chainId || 0)) {
          // Use a default chainId if undefined for token list
          emptyBalances[id] = "0";
        }
        return emptyBalances;
      }
      return _fetchAccountBalances(address, chainId);
    },
    {
      staleTime: BALANCE_STALE_TIME,
      enabled: !!address && !!chainId, // Query will only run if address and chainId are truthy
      // Consider adding placeholderData or initialData if you want to show a default structure sooner.
      // For example, initialData could be an empty map of balances for all tokens.
      placeholderData: () => {
        // Return an empty structure during initial load or when disabled
        const placeholder: AccountBalances = {} as AccountBalances;
        for (const id of getTokenOptionsByChainId(chainId || 0)) {
          // Use a default chainId if undefined for token list
          placeholder[id] = "0";
        }
        return placeholder;
      },
      retry: 1, // Optional: retry failed requests once
    },
  );
}
