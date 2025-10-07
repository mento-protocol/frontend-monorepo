import { getTokenDecimals } from "@/config/tokens";
import { fromWei, fromWeiRounded } from "@/utils/amount";
import { TokenSymbol } from "@mento-protocol/mento-sdk";
import { toast } from "@repo/ui";
import type { UseFormSetValue } from "react-hook-form";
import { useAccount, useChainId } from "wagmi";

import { AccountBalances } from "@/features/accounts";
import type { SwapFormValues } from "../types";

// Gets the user's token balances and checks if the user has enough balance to perform a swap
export function useTokenBalance(
  balances: AccountBalances,
  tokenSymbol: TokenSymbol,
  setValue: UseFormSetValue<SwapFormValues>,
) {
  const { isConnected } = useAccount();
  const chainId = useChainId();

  const balance = balances[tokenSymbol];
  const decimals = getTokenDecimals(tokenSymbol, chainId);
  const roundedBalance = fromWeiRounded(balance, decimals);
  const hasBalance = Boolean(Number.parseFloat(roundedBalance) > 0);

  const useMaxBalance = () => {
    const maxAmount = fromWei(balance, decimals);
    setValue("amount", maxAmount, { shouldValidate: true, shouldDirty: true });
    setValue("direction", "in", { shouldValidate: true, shouldDirty: true });

    if (tokenSymbol === "CELO") {
      toast.warning("Consider keeping some CELO for transaction fees");
    }
  };

  return {
    balance: roundedBalance,
    hasBalance: isConnected && hasBalance,
    useMaxBalance,
  };
}
