import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";
import { useProvider } from "wagmi";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import { parseInputExchangeAmount } from "@/features/swap/utils";
import {
  getTokenAddress,
  type TokenId,
  NativeTokenId,
} from "@/lib/config/tokens";
import { fromWei } from "@/lib/utils/amount";
import { logger } from "@/lib/utils/logger";
import type { SwapDirection } from "@/features/swap/types";

interface GasEstimationParams {
  amount: string;
  quote: string;
  fromTokenId: TokenId;
  toTokenId: TokenId;
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
  fromTokenId,
  toTokenId,
  direction,
  address,
  chainId,
  slippage,
  skipApprove,
  enabled = true,
}: GasEstimationParams) {
  const provider = useProvider({ chainId });

  const exactBuyAmountBN = parseInputExchangeAmount(
    amount, // amount the user wants to BUY
    toTokenId, // use *to* token’s decimals
  );

  return useQuery<GasEstimationResult | null>(
    [
      "gas-estimate",
      amount,
      quote,
      fromTokenId,
      toTokenId,
      direction,
      address,
      chainId,
      slippage,
      skipApprove,
    ],
    async () => {
      if (
        !address ||
        !amount ||
        !quote ||
        !provider ||
        parseFloat(amount) <= 0
      ) {
        return null;
      }

      // Don't estimate gas if approval is needed (unless it's native token)
      if (!skipApprove && fromTokenId !== NativeTokenId) {
        logger.info("Skipping gas estimation - approval needed first");
        return null;
      }

      try {
        // For swap quote, we just need to estimate a simple transfer
        // This gives us a baseline gas cost without needing approval
        if (!skipApprove && fromTokenId !== NativeTokenId) {
          // Estimate gas for a simple transfer as a baseline
          const fromTokenAddr = getTokenAddress(fromTokenId, chainId);
          const transferData = ethers.utils.defaultAbiCoder.encode(
            ["address", "uint256"],
            [address, parseInputExchangeAmount(amount, fromTokenId)],
          );

          const gasEstimate = await provider
            .estimateGas({
              from: address,
              to: fromTokenAddr,
              data: "0xa9059cbb" + transferData.slice(2), // transfer(address,uint256) selector
            })
            .catch(() => ethers.BigNumber.from("100000")); // Fallback for transfer

          const gasPrice = await provider.getGasPrice();
          const totalFeeWei = gasEstimate.mul(gasPrice);
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
        const fromTokenAddr = getTokenAddress(fromTokenId, chainId);
        const toTokenAddr = getTokenAddress(toTokenId, chainId);
        const tradablePair = await getTradablePairForTokens(
          chainId,
          fromTokenId,
          toTokenId,
        );

        const amountInWei = parseInputExchangeAmount(amount, fromTokenId);
        const quoteInWei = parseInputExchangeAmount(quote, toTokenId);
        const amountWeiBN = ethers.BigNumber.from(amountInWei);
        const quoteWeiBN = ethers.BigNumber.from(quoteInWei);

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

        const txRequest = await swapFn(
          fromTokenAddr,
          toTokenAddr,
          exactBuyAmountBN,
          thresholdAmountBN,
          tradablePair,
        );

        logger.info("Gas estimation tx request:", {
          to: txRequest.to,
          from: address,
          skipApprove,
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
            const gasEstimate = await provider.estimateGas({
              from: address,
              to: txRequest.to,
              data: txRequest.data,
              value: txRequest.value || ethers.constants.Zero,
            });

            // Add 20% buffer
            estimatedGas = gasEstimate.mul(120).div(100);
            logger.info("Estimated gas with buffer:", estimatedGas.toString());
          } catch (estimateError: any) {
            // If estimation fails, check if it's due to approval
            if (
              estimateError?.message?.includes("SafeERC20") ||
              estimateError?.message?.includes("low-level call failed")
            ) {
              logger.warn("Gas estimation failed due to missing approval");
              // Return a reasonable estimate for UI display
              estimatedGas = ethers.BigNumber.from("250000");
            } else {
              // Other errors - use fallback
              logger.warn("Gas estimation failed:", estimateError?.message);
              estimatedGas = ethers.BigNumber.from("300000");
            }
          }
        }

        // Get current gas price
        const gasPrice = await provider.getGasPrice();
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
      } catch (error: any) {
        logger.error("Gas estimation error:", {
          error: error?.message,
          reason: error?.reason,
          code: error?.code,
        });

        // Return a reasonable estimate instead of null
        // This allows the UI to show an approximate fee
        const fallbackGas = ethers.BigNumber.from("250000");
        const gasPrice = await provider.getGasPrice().catch(
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
    {
      enabled: enabled && !!address && !!amount && !!quote && !!provider,
      staleTime: 10000,
      cacheTime: 30000,
      retry: 1,
      retryDelay: 1000,
      refetchInterval: false,
      refetchOnWindowFocus: false,
    },
  );
}
