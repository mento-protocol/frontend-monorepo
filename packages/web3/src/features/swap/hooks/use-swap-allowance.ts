import BigNumber from "bignumber.js";
import type { TokenId } from "@/config/tokens";
import { useAllowance } from "./use-allowance";

interface ISwapAllowanceOptions {
  chainId: number;
  fromTokenId: TokenId;
  toTokenId: TokenId;
  approveAmount: string;
  address?: string;
}

export function useSwapAllowance(options: ISwapAllowanceOptions) {
  const { chainId, fromTokenId, toTokenId, approveAmount, address } = options;
  const { allowance, isLoading: isAllowanceLoading } = useAllowance(
    chainId,
    fromTokenId,
    toTokenId,
    address,
  );

  const needsApproval =
    !isAllowanceLoading && new BigNumber(allowance).lt(approveAmount);
  const skipApprove = !isAllowanceLoading && !needsApproval;

  // Debug log when values change
  // useEffect(() => {
  //   logger.info("Allowance status:", {
  //     isLoading: isAllowanceLoading,
  //     needsApproval,
  //     allowance,
  //     approveAmount,
  //   });
  // }, [isAllowanceLoading, needsApproval, allowance, approveAmount]);

  return {
    allowance,
    isAllowanceLoading,
    needsApproval,
    skipApprove,
  };
}
