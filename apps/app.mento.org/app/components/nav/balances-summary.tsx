"use client";

import { type TokenId, Tokens } from "@/lib/config/tokens";
import { useAccountBalances } from "@/features/accounts/use-account-balances";
import { useAccount, useChainId } from "wagmi";
import { TokenIcon } from "@repo/ui";
import { fromWeiRounded } from "@/lib/utils/amount";

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

  const tokenIds = balances ? (Object.keys(balances) as TokenId[]) : [];

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
    tokenIds.length === 0 ||
    tokenIds.every((id) => balances[id] === "0")
  ) {
    return (
      <div className="flex flex-col space-y-2">
        <p className="text-muted-foreground text-sm">No balances to display</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tokenIds.map((id) => {
        const balanceValue = balances[id];
        const balance = fromWeiRounded(balanceValue, Tokens[id].decimals);
        if (balance !== "0") {
          const token = Tokens[id];
          return (
            <div
              key={id}
              className="text-foreground flex min-w-0 items-center gap-3 text-sm font-medium"
            >
              <TokenIcon token={token} />
              <span className="truncate">{balance}</span>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
