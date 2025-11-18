"use client";

import { getTokenBySymbol, getTokenDecimals } from "@/config/tokens";
import { useAccountBalances } from "@/features/accounts/use-account-balances";
import { formatWithMaxDecimals } from "@/features/swap/utils";
import { formatBalance } from "@repo/web3";
import { TokenSymbol } from "@mento-protocol/mento-sdk";
import { TokenIcon } from "@repo/ui";
import { useAccount, useChainId } from "wagmi";

export function BalancesSummary() {
  const { address } = useAccount();
  const chainId = useChainId();
  const {
    data: balances,
    isLoading,
    isError,
  } = useAccountBalances({
    address: address,
    chainId: chainId,
  });

  const tokenSymbols = balances ? (Object.keys(balances) as TokenSymbol[]) : [];

  if (isLoading) {
    return (
      <div className="flex flex-col space-y-2">
        <p className="text-muted-foreground text-sm">Loading balances...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col space-y-2">
        <p className="text-destructive text-sm">Error fetching balances.</p>
      </div>
    );
  }

  if (
    !balances ||
    tokenSymbols.length === 0 ||
    tokenSymbols.every((symbol) => balances[symbol] === "0")
  ) {
    return (
      <div className="flex flex-col space-y-2">
        <p className="text-muted-foreground text-sm">No balances to display</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tokenSymbols.map((symbol) => {
        const balanceValue = balances[symbol];
        const decimals = getTokenDecimals(symbol, chainId);
        const balance = formatBalance(balanceValue ?? "0", decimals);
        if (balance !== "0") {
          const token = getTokenBySymbol(symbol, chainId);

          // If token details aren't loaded yet, show with fallback
          const tokenData = token ?? {
            address: "0x0000000000000000000000000000000000000000",
            symbol,
            name: symbol,
            decimals: decimals ?? 18,
          };

          return (
            <div
              key={symbol}
              className="text-foreground flex items-center gap-3 px-4 py-1 text-sm font-medium"
              data-testid={`walletSettings_${tokenData.symbol}_balance`}
            >
              <TokenIcon token={tokenData} className="h-6 w-6 p-1" />
              <span className="truncate">{formatWithMaxDecimals(balance)}</span>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
