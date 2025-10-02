import { toast } from "@repo/ui";
import { TokenId, getTokenDecimals } from "@/config/tokens";
import { fromWei, fromWeiRounded } from "@/utils/amount";
import { useAccount, useChainId } from "wagmi";
import type { UseFormSetValue } from "react-hook-form";

import type { SwapFormValues } from "../types";
import { AccountBalances } from "@/features/accounts";

// Gets the user's token balances and checks if the user has enough balance to perform a swap
export function useTokenBalance(
  balances: AccountBalances,
  tokenId: TokenId,
  setValue: UseFormSetValue<SwapFormValues>,
) {
  const { isConnected } = useAccount();
  const chainId = useChainId();

  const balance = balances[tokenId];
  const decimals = getTokenDecimals(tokenId, chainId);
  const roundedBalance = fromWeiRounded(balance, decimals);
  const hasBalance = Boolean(Number.parseFloat(roundedBalance) > 0);

  const useMaxBalance = () => {
    const maxAmount = fromWei(balance, decimals);
    setValue("amount", maxAmount, { shouldValidate: true, shouldDirty: true });
    setValue("direction", "in", { shouldValidate: true, shouldDirty: true });

    if (tokenId === TokenId.CELO) {
      toast.warning("Consider keeping some CELO for transaction fees");
    }
  };

  return {
    balance: roundedBalance,
    hasBalance: isConnected && hasBalance,
    useMaxBalance,
  };
}
