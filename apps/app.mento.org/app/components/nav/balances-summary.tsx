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
      <div className="flex flex-col pl-5">
        <p className="dark:text-white">Loading balances...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col pl-5">
        <p className="text-red-500">Error fetching balances.</p>
      </div>
    );
  }

  if (
    !balances ||
    tokenIds.length === 0 ||
    tokenIds.every((id) => balances[id] === "0")
  ) {
    return (
      <div className="flex flex-col pl-5">
        {/* Optionally, show a message if all balances are zero or no balances found */}
        {/* <p className="dark:text-gray-500">No token balances to display.</p> */}
        {/* Or render nothing for a cleaner UI when balances are zero */}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col pl-5">
        {tokenIds.map((id) => {
          const balanceValue = balances[id];
          const balance = fromWeiRounded(balanceValue, Tokens[id].decimals);
          if (balance !== "0") {
            const token = Tokens[id];
            // TODO: @bayo Either revert this !== 0 check or add some animation for when balances are loading
            return (
              <div
                style={{ minWidth: "35%" }}
                className="flex pb-4 dark:text-white"
                key={id}
              >
                <TokenIcon token={token} size="xs" />
                <div className="ml-3">{balance}</div>
              </div>
            );
          }
          return null;
        })}
      </div>
      <hr className="dark:border-[#333336]" />
    </>
  );
}
