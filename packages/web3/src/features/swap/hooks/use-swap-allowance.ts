import BigNumber from "bignumber.js";
import type { TokenId } from "@/config/tokens";
import { useAllowance } from "./use-allowance";

interface ISwapAllowanceOptions {
  chainId: number;
  tokenInId: TokenId;
  tokenOutId: TokenId;
  approveAmount: string;
  address?: string;
}

export function useSwapAllowance(options: ISwapAllowanceOptions) {
  const { chainId, tokenInId, tokenOutId, approveAmount, address } = options;
  const { allowance, isLoading: isAllowanceLoading } = useAllowance(
    chainId,
    tokenInId,
    tokenOutId,
    address,
  );

  const needsApproval =
    !isAllowanceLoading && new BigNumber(allowance).lt(approveAmount);
  const skipApprove = !isAllowanceLoading && !needsApproval;

  return {
    allowance,
    isAllowanceLoading,
    needsApproval,
    skipApprove,
  };
}
