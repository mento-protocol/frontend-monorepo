import { TokenSymbol } from "@mento-protocol/mento-sdk";
import BigNumber from "bignumber.js";
import { useAppAllowance } from "./use-allowance";

interface ISwapAllowanceOptions {
  chainId: number;
  tokenInSymbol: TokenSymbol;
  tokenOutSymbol: TokenSymbol;
  approveAmount: string;
  address?: string;
}

export function useSwapAllowance(options: ISwapAllowanceOptions) {
  const { chainId, tokenInSymbol, tokenOutSymbol, approveAmount, address } =
    options;
  const { allowance, isLoading: isAllowanceLoading } = useAppAllowance(
    chainId,
    tokenInSymbol,
    tokenOutSymbol,
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
