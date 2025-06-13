import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";
import { useProvider, useAccount, useChainId } from "wagmi";
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
import { ERC20_ABI } from "@/lib/config/consts";

interface GasEstimationParams {
  amount: string;
  quote: string;
  fromTokenId: TokenId;
  toTokenId: TokenId;
  direction: SwapDirection;
  slippage: string;
  skipApprove?: boolean;
}

interface GasEstimationResult {
  gasEstimate: string;
  gasPrice: string;
  totalFeeWei: string;
  totalFeeFormatted: string;
  totalFeeUSD: string;
  error?: string;
  warning?: string;
}

export function useGasEstimation({
  amount,
  quote,
  direction,
  fromTokenId,
  toTokenId,
  slippage = "0.5",
  skipApprove = false,
}: GasEstimationParams) {
  const { address } = useAccount();
  const chainId = useChainId();
  const provider = useProvider({ chainId });

  const { data: gasEstimate, isLoading: isGasEstimating } =
    useQuery<GasEstimationResult | null>(
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
          // Check allowance before attempting gas estimation
          if (fromTokenId !== NativeTokenId) {
            const fromTokenAddr = getTokenAddress(fromTokenId, chainId);
            const sdk = await getMentoSdk(chainId);
            const brokerAddress = sdk.getBroker().address;

            // Create contract instance to check allowance
            const tokenContract = new ethers.Contract(
              fromTokenAddr,
              ERC20_ABI,
              provider,
            );

            const amountInWei = parseInputExchangeAmount(amount, fromTokenId);
            const allowance = await tokenContract.allowance(
              address,
              brokerAddress,
            );

            logger.info("Checking allowance before gas estimation:", {
              allowance: allowance.toString(),
              amountInWei: amountInWei.toString(),
              needsApproval: allowance.lt(amountInWei),
            });

            if (allowance.lt(amountInWei)) {
              logger.warn(
                "Insufficient allowance for swap, skipping gas estimation",
              );
              return {
                gasEstimate: "0",
                gasPrice: "0",
                totalFeeWei: "0",
                totalFeeFormatted: "0",
                totalFeeUSD: "0",
                error:
                  "Insufficient allowance. Please approve the token first.",
              };
            }
          }

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
              .catch((error: any) => {
                // If estimation fails due to "amountOutMin not met", use a reasonable default
                if (error?.error?.message?.includes("amountOutMin not met")) {
                  logger.warn(
                    "Gas estimation failed due to slippage, using default gas estimate",
                  );
                  return ethers.BigNumber.from("100000"); // Fallback for transfer
                }
                throw error;
              });

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
          const swapFn = isSwapIn
            ? sdk.swapIn.bind(sdk)
            : sdk.swapOut.bind(sdk);

          const txRequest = await swapFn(
            fromTokenAddr,
            toTokenAddr,
            isSwapIn ? amountWeiBN : quoteWeiBN,
            thresholdAmountBN,
            tradablePair,
          );

          logger.info("Gas estimation tx request:", {
            to: txRequest.to,
            from: address,
            skipApprove,
            method: isSwapIn ? "swapIn" : "swapOut",
          });

          const gasEstimate = await provider
            .estimateGas({
              ...txRequest,
              from: address,
            })
            .catch((error: any) => {
              // If estimation fails due to "amountOutMin not met", use a reasonable default
              if (error?.error?.message?.includes("amountOutMin not met")) {
                logger.warn(
                  "Gas estimation failed due to slippage, using default gas estimate",
                );
                return ethers.BigNumber.from("250000"); // Reasonable default for swap
              }
              throw error;
            });

          // Get current gas price
          const gasPrice = await provider.getGasPrice();
          const totalFeeWei = gasEstimate.mul(gasPrice);
          const totalFeeFormatted = fromWei(totalFeeWei.toString(), 18);

          // Estimate USD value
          const celoPrice = 0.7; // TODO: Fetch actual price
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
        } catch (error: any) {
          logger.warn("Gas estimation failed:", error);

          // For "amountOutMin not met" errors, return a reasonable estimate
          if (
            error?.error?.message?.includes("amountOutMin not met") ||
            error?.reason?.includes("amountOutMin not met")
          ) {
            const defaultGasEstimate = ethers.BigNumber.from("250000");
            const gasPrice = await provider.getGasPrice();
            const totalFeeWei = defaultGasEstimate.mul(gasPrice);
            const totalFeeFormatted = fromWei(totalFeeWei.toString(), 18);
            const celoPrice = 0.7;
            const totalFeeUSD = (
              parseFloat(totalFeeFormatted) * celoPrice
            ).toFixed(4);

            return {
              gasEstimate: defaultGasEstimate.toString(),
              gasPrice: gasPrice.toString(),
              totalFeeWei: totalFeeWei.toString(),
              totalFeeFormatted,
              totalFeeUSD,
              warning: "Gas estimate may vary due to market conditions",
            };
          }

          // For other errors, return null
          return null;
        }
      },
      {
        enabled: !!address && !!amount && !!quote && !!provider,
        staleTime: 10000,
        cacheTime: 30000,
        retry: 1,
        retryDelay: 1000,
        refetchInterval: false,
        refetchOnWindowFocus: false,
      },
    );

  return { gasEstimate, isGasEstimating };
}
