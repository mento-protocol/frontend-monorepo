import { toast } from "@repo/ui";
import { TokenId, Tokens } from "@/lib/config/tokens";
import type { AccountBalances } from "@/features/accounts/use-account-balances";
import { fromWei, fromWeiRounded } from "@/lib/utils/amount";
import { useAccount } from "wagmi";
import type { UseFormSetValue } from "react-hook-form";

import type { SwapFormValues } from "../types";

// Gets the user's token balances and checks if the user has enough balance to perform a swap
export function useTokenBalance(
  balances: AccountBalances,
  tokenId: TokenId,
  setValue: UseFormSetValue<SwapFormValues>,
) {
  const { isConnected } = useAccount();

  const balance = balances[tokenId];
  const roundedBalance = fromWeiRounded(balance, Tokens[tokenId].decimals);
  const hasBalance = Boolean(Number.parseFloat(roundedBalance) > 0);

  const useMaxBalance = () => {
    const maxAmount = fromWei(balance, Tokens[tokenId].decimals);
    setValue("amount", maxAmount, { shouldValidate: true, shouldDirty: true });
    setValue("direction", "in", { shouldValidate: true, shouldDirty: true });

    if (tokenId === TokenId.CELO) {
      toast.warn("Consider keeping some CELO for transaction fees");
    }
  };

  return {
    balance: roundedBalance,
    hasBalance: isConnected && hasBalance,
    useMaxBalance,
  };
}
