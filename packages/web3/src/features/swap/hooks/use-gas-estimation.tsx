import { getTokenAddress, NativeTokenId, type TokenId } from "@/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import type { SwapDirection } from "@/features/swap/types";
import { parseInputExchangeAmount } from "@/features/swap/utils";
import { fromWei } from "@/utils/amount";
import { logger } from "@/utils/logger";
import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";
import type { Address, Hex } from "viem";
import { usePublicClient } from "wagmi";

interface GasEstimationParams {
  amount: string;
  quote: string;
  tokenInId: TokenId;
  tokenOutId: TokenId;
  direction: SwapDirection;
  address?: string;
  chainId: number;
  slippage: string;
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

export function useGasEstimation({
  amount,
  quote,
  tokenInId,
  tokenOutId,
  direction,
  address,
  chainId,
  slippage,
  skipApprove,
  enabled = true,
}: GasEstimationParams) {
  const publicClient = usePublicClient({ chainId });

  return useQuery<GasEstimationResult | null>({
    queryKey: [
      "gas-estimate",
      amount,
      quote,
      tokenInId,
      tokenOutId,
      direction,
      address,
      chainId,
      slippage,
      skipApprove,
    ],
    queryFn: async () => {
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
        // For swap quote, we just need to estimate a simple transfer
        // This gives us a baseline gas cost without needing approval
        if (!skipApprove && tokenInId !== NativeTokenId) {
          // Estimate gas for a simple transfer as a baseline
          const fromTokenAddr = getTokenAddress(tokenInId, chainId);

          // For swapOut, we need to check allowance for the quote amount (fromToken)
          // For swapIn, we check allowance for the amount (fromToken)
          const valueToCheck = direction === "out" ? quote : amount;

          const transferData = ethers.utils.defaultAbiCoder.encode(
            ["address", "uint256"],
            [
              address,
              parseInputExchangeAmount(valueToCheck, tokenInId, chainId),
            ],
          );

          const gasEstimate = await publicClient
            .estimateGas({
              account: address as Address,
              to: fromTokenAddr as Address,
              data: ("0xa9059cbb" + transferData.slice(2)) as Hex,
            })
            .catch(() => ethers.BigNumber.from("100000")); // Fallback for transfer

          const gasPrice = await publicClient.getGasPrice();
          const totalFeeWei =
            typeof gasEstimate === "bigint" ? gasEstimate * gasPrice : 0;
          const totalFeeFormatted = fromWei(totalFeeWei.toString(), 18);
          const celoPrice = 0.7;
          const totalFeeUSD = (
            parseFloat(totalFeeFormatted) * celoPrice
          ).toFixed(4);

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
        const fromTokenAddr = getTokenAddress(tokenInId, chainId);
        const toTokenAddr = getTokenAddress(tokenOutId, chainId);
        const tradablePair = await getTradablePairForTokens(
          chainId,
          tokenInId,
          tokenOutId,
        );

        // Parse amounts based on direction
        let amountWeiBN: ethers.BigNumber;
        let quoteWeiBN: ethers.BigNumber;

        if (direction === "in") {
          // swapIn: amount is fromToken (sell), quote is toToken (receive)
          const amountInWei = parseInputExchangeAmount(
            amount,
            tokenInId,
            chainId,
          );
          const quoteInWei = parseInputExchangeAmount(
            quote,
            tokenOutId,
            chainId,
          );
          amountWeiBN = ethers.BigNumber.from(amountInWei);
          quoteWeiBN = ethers.BigNumber.from(quoteInWei);
        } else {
          // swapOut: quote is fromToken (sell), amount is toToken (receive)
          const amountInWei = parseInputExchangeAmount(
            amount,
            tokenOutId,
            chainId,
          );
          const quoteInWei = parseInputExchangeAmount(
            quote,
            tokenInId,
            chainId,
          );
          amountWeiBN = ethers.BigNumber.from(amountInWei);
          quoteWeiBN = ethers.BigNumber.from(quoteInWei);
        }

        // Calculate threshold with slippage
        const slippageBps = Math.floor(parseFloat(slippage) * 100);
        let thresholdAmountBN: ethers.BigNumber;

        if (direction === "in") {
          thresholdAmountBN = quoteWeiBN.mul(10000 - slippageBps).div(10000);
        } else {
          thresholdAmountBN = quoteWeiBN.mul(10000 + slippageBps).div(10000);
        }

        // Build transaction for gas estimation
        const isSwapIn = direction === "in";
        const swapFn = isSwapIn ? sdk.swapIn.bind(sdk) : sdk.swapOut.bind(sdk);

        // Use correct amount parameter based on direction
        // For swapIn: amountWeiBN is the exact sell amount (fromToken)
        // For swapOut: amountWeiBN is the exact buy amount (toToken)
        const exactAmount = amountWeiBN;

        const txRequest = await swapFn(
          fromTokenAddr,
          toTokenAddr,
          exactAmount,
          thresholdAmountBN,
          tradablePair,
        );

        logger.info("Gas estimation tx request:", {
          to: txRequest.to,
          account: address as Address,
          method: isSwapIn ? "swapIn" : "swapOut",
        });

        let estimatedGas: ethers.BigNumber;

        // Use SDK's gas limit if available
        if (txRequest.gasLimit) {
          estimatedGas = ethers.BigNumber.from(txRequest.gasLimit);
          logger.info("Using SDK provided gas limit:", estimatedGas.toString());
        } else {
          // Try to estimate gas
          try {
            const gasEstimate = await publicClient.estimateGas({
              account: address as Address,
              to: txRequest.to as Address,
              data: txRequest.data as Hex | undefined,
              value: txRequest.value
                ? BigInt(txRequest.value.toString())
                : undefined,
            });

            const gasEstimateBN = ethers.BigNumber.from(gasEstimate);
            estimatedGas = gasEstimateBN.mul(120).div(100);
            logger.info("Estimated gas with buffer:", estimatedGas.toString());
          } catch (estimateError: unknown) {
            const errorMessage =
              estimateError instanceof Error
                ? estimateError.message
                : String(estimateError);

            // If estimation fails, check if it's due to approval
            if (
              errorMessage.includes("SafeERC20") ||
              errorMessage.includes("low-level call failed")
            ) {
              logger.warn("Gas estimation failed due to missing approval");
              // Return a reasonable estimate for UI display
              estimatedGas = ethers.BigNumber.from("250000");
            } else {
              // Other errors - use fallback
              logger.warn("Gas estimation failed:", errorMessage);
              estimatedGas = ethers.BigNumber.from("300000");
            }
          }
        }

        // Get current gas price
        const gasPrice = await publicClient.getGasPrice();
        const totalFeeWei = estimatedGas.mul(gasPrice);
        const totalFeeFormatted = fromWei(totalFeeWei.toString(), 18);

        // Estimate USD value
        const celoPrice = 0.7; // TODO: Fetch actual price
        const totalFeeUSD = (parseFloat(totalFeeFormatted) * celoPrice).toFixed(
          4,
        );

        return {
          gasEstimate: estimatedGas.toString(),
          gasPrice: gasPrice.toString(),
          totalFeeWei: totalFeeWei.toString(),
          totalFeeFormatted,
          totalFeeUSD,
        };
      } catch (error: unknown) {
        logger.error("Gas estimation error:", {
          error: error instanceof Error ? error.message : String(error),
        });

        // Return a reasonable estimate instead of null
        // This allows the UI to show an approximate fee
        const fallbackGas = ethers.BigNumber.from("250000");
        const gasPrice = await publicClient.getGasPrice().catch(
          () => ethers.BigNumber.from("5000000000"), // 5 gwei fallback
        );
        const totalFeeWei = fallbackGas.mul(gasPrice);
        const totalFeeFormatted = fromWei(totalFeeWei.toString(), 18);
        const totalFeeUSD = (parseFloat(totalFeeFormatted) * 0.7).toFixed(4);

        return {
          gasEstimate: fallbackGas.toString(),
          gasPrice: gasPrice.toString(),
          totalFeeWei: totalFeeWei.toString(),
          totalFeeFormatted: totalFeeFormatted + " (est.)",
          totalFeeUSD,
        };
      }
    },
    enabled: enabled && !!address && !!amount && !!quote && !!publicClient,
    staleTime: 10000,
    gcTime: 30000,
    retry: 1,
    retryDelay: 1000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
}
