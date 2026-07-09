import { ChainId } from "@/config/chains";
import { getNativeTokenSymbol } from "@/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import { buildApproveTransactionRequest } from "@/features/swap/hooks/build-approve-transaction-request";
import {
  isInsufficientLiquidityError,
  SWAP_INSUFFICIENT_LIQUIDITY_LABEL,
} from "@/features/swap/error-handlers";
import { parseInputExchangeAmount, parseSlippage } from "@/features/swap/utils";
import { fromWei } from "@/utils/amount";
import { validateAddress } from "@/utils/addresses";
import { logger } from "@/utils/logger";
import { TokenSymbol, getTokenAddress } from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { usePublicClient } from "wagmi";

interface GasEstimationParams {
  amount: string;
  quote: string;
  tokenInSymbol: TokenSymbol;
  tokenOutSymbol: TokenSymbol;
  address?: string;
  chainId: number;
  slippage: string;
  deadlineMinutes?: string;
  skipApprove?: boolean; // Add this to know if approval is needed
  enabled?: boolean;
}

interface GasEstimationResult {
  gasEstimate: string;
  gasPrice: string;
  totalFeeWei: string;
  totalFeeFormatted: string;
  totalFeeUSD: string;
}

type GasEstimationPublicClient = ReturnType<typeof usePublicClient>;

function getApproxNativeTokenUsdPrice(chainId: number): number | null {
  switch (chainId) {
    case ChainId.Celo:
    case ChainId.CeloSepolia:
      return 0.7;
    case ChainId.Monad:
    case ChainId.MonadTestnet:
      return null;
    default:
      return null;
  }
}

function formatTotalFeeUsd(totalFeeFormatted: string, chainId: number): string {
  const nativeTokenPrice = getApproxNativeTokenUsdPrice(chainId);
  if (nativeTokenPrice == null) {
    return "";
  }

  return (parseFloat(totalFeeFormatted) * nativeTokenPrice).toFixed(4);
}

/**
 * Estimates the gas cost of the transaction the user is about to sign.
 *
 * When an ERC20 approval is still pending, this estimates the real
 * `approve(Router, amountInWei)` transaction (not a stand-in transfer). When
 * approval is already in place (or the input is the native token), it estimates
 * the actual swap. If estimation fails for any non-liquidity reason the fee is
 * unavailable and the function returns `null` — it never fabricates a number.
 * Insufficient-liquidity errors are re-thrown so the UI can surface them.
 */
export async function fetchGasEstimation(
  params: Omit<GasEstimationParams, "enabled">,
  publicClient: GasEstimationPublicClient,
): Promise<GasEstimationResult | null> {
  const {
    amount,
    quote,
    tokenInSymbol,
    tokenOutSymbol,
    address,
    chainId,
    slippage,
    deadlineMinutes = "5",
    skipApprove,
  } = params;

  if (
    !publicClient ||
    !amount ||
    !quote ||
    !address ||
    amount === "0" ||
    quote === "0"
  ) {
    return null;
  }

  try {
    // Approval still pending: estimate the exact approve tx the user will sign.
    if (!skipApprove && tokenInSymbol !== getNativeTokenSymbol(chainId)) {
      const approveRequest = buildApproveTransactionRequest(
        chainId,
        tokenInSymbol,
        parseInputExchangeAmount(amount, tokenInSymbol, chainId),
      );

      const gasEstimate = await publicClient.estimateGas({
        account: address as Address,
        to: approveRequest.to,
        data: approveRequest.data,
      });

      const gasPrice = await publicClient.getGasPrice();
      const totalFeeWei = gasEstimate * gasPrice;
      const totalFeeFormatted = fromWei(totalFeeWei.toString(), 18);
      const totalFeeUSD = formatTotalFeeUsd(totalFeeFormatted, chainId);

      return {
        gasEstimate: gasEstimate.toString(),
        gasPrice: gasPrice.toString(),
        totalFeeWei: totalFeeWei.toString(),
        totalFeeFormatted,
        totalFeeUSD,
      };
    }

    // If approval is not needed, estimate the actual swap
    const sdk = await getMentoSdk(chainId);
    const fromTokenAddr = getTokenAddress(chainId, tokenInSymbol);
    const toTokenAddr = getTokenAddress(chainId, tokenOutSymbol);
    if (!fromTokenAddr) {
      throw new Error(
        `${tokenInSymbol} token address not found on chain ${chainId}`,
      );
    }
    if (!toTokenAddr) {
      throw new Error(
        `${tokenOutSymbol} token address not found on chain ${chainId}`,
      );
    }
    const tradablePair = await getTradablePairForTokens(
      chainId,
      tokenInSymbol,
      tokenOutSymbol,
    );

    // swapIn: amount is fromToken (sell), quote is toToken (receive)
    const amountInWei = parseInputExchangeAmount(
      amount,
      tokenInSymbol,
      chainId,
    );

    // Build transaction for gas estimation
    const deadlineSeconds = parseInt(deadlineMinutes, 10) * 60;
    const block = await publicClient.getBlock();
    const deadline = block.timestamp + BigInt(deadlineSeconds);

    const { swap } = await sdk.swap.buildSwapTransaction(
      fromTokenAddr,
      toTokenAddr,
      BigInt(amountInWei),
      address, // recipient
      address, // owner
      { slippageTolerance: parseSlippage(slippage), deadline },
      tradablePair,
    );
    const txRequest = swap.params;

    logger.info("Gas estimation tx request:", {
      to: txRequest.to,
      account: address as Address,
      method: "swap.buildSwapTransaction",
    });

    validateAddress(txRequest.to, "gas estimation");

    let estimatedGas: bigint;

    // Try to estimate gas
    try {
      const gasEstimate = await publicClient.estimateGas({
        account: address as Address,
        to: txRequest.to as Address,
        data: txRequest.data as Hex | undefined,
        value: txRequest.value ? BigInt(txRequest.value.toString()) : undefined,
      });

      estimatedGas = (gasEstimate * 120n) / 100n;
      logger.info("Estimated gas with buffer:", estimatedGas.toString());
    } catch (estimateError: unknown) {
      logger.error("Gas estimation tx response:", estimateError);

      const errorMessage =
        estimateError instanceof Error
          ? estimateError.message
          : String(estimateError);

      // Insufficient liquidity - surface to UI instead of falling back
      if (isInsufficientLiquidityError(errorMessage)) {
        throw new Error(SWAP_INSUFFICIENT_LIQUIDITY_LABEL);
      }

      // Estimation failed for another reason — the fee is unavailable.
      logger.warn("Gas estimation failed:", errorMessage);
      return null;
    }

    // Get current gas price
    const gasPrice = await publicClient.getGasPrice();
    const totalFeeWei = estimatedGas * gasPrice;
    const totalFeeFormatted = fromWei(totalFeeWei.toString(), 18);

    const totalFeeUSD = formatTotalFeeUsd(totalFeeFormatted, chainId);

    return {
      gasEstimate: estimatedGas.toString(),
      gasPrice: gasPrice.toString(),
      totalFeeWei: totalFeeWei.toString(),
      totalFeeFormatted,
      totalFeeUSD,
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Insufficient liquidity - re-throw to surface in UI
    if (isInsufficientLiquidityError(errorMsg)) {
      throw error;
    }

    logger.error("Gas estimation error:", { error: errorMsg });

    // Estimation is unavailable — return null rather than a fabricated fee.
    return null;
  }
}

export function useGasEstimation({
  amount,
  quote,
  tokenInSymbol,
  tokenOutSymbol,
  address,
  chainId,
  slippage,
  deadlineMinutes = "5",
  skipApprove,
  enabled = true,
}: GasEstimationParams) {
  const publicClient = usePublicClient({ chainId });

  return useQuery<GasEstimationResult | null>({
    queryKey: [
      "gas-estimate",
      amount,
      quote,
      tokenInSymbol,
      tokenOutSymbol,
      address,
      chainId,
      slippage,
      skipApprove,
    ],
    queryFn: () =>
      fetchGasEstimation(
        {
          amount,
          quote,
          tokenInSymbol,
          tokenOutSymbol,
          address,
          chainId,
          slippage,
          deadlineMinutes,
          skipApprove,
        },
        publicClient,
      ),
    enabled: enabled && !!address && !!amount && !!quote && !!publicClient,
    staleTime: 10000,
    gcTime: 30000,
    retry: (failureCount, error) => {
      if (isInsufficientLiquidityError(error)) return false;
      return failureCount < 1;
    },
    retryDelay: 1000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
}
