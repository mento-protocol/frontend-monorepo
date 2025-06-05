import BigNumber from "bignumber.js";
import { useEffect } from "react";
import type { TokenId } from "@/lib/config/tokens";
import { logger } from "@/lib/utils/logger";

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

  // Log only when values change
  useEffect(() => {
    logger.info("Allowance status:", {
      isLoading: isAllowanceLoading,
      needsApproval,
      allowance,
      approveAmount,
    });
  }, [isAllowanceLoading, needsApproval, allowance, approveAmount]);

  return {
    allowance,
    isAllowanceLoading,
    needsApproval,
    skipApprove,
  };
}
