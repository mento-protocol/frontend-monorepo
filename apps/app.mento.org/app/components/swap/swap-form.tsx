"use client";
import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@repo/ui";
import { Controller, useForm, useWatch } from "react-hook-form";
import * as z from "zod";

import {
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@repo/ui";

import { CoinInput } from "@repo/ui";

import { ConnectButton } from "@/components/nav/connect-button";
import { useAccountBalances } from "@/features/accounts/use-account-balances";
import { useSwapQuote } from "@/features/swap/hooks/use-swap-quote";
import { confirmViewAtom, formValuesAtom } from "@/features/swap/swap-atoms";
import { type TokenId, Tokens } from "@/lib/config/tokens";
import { fromWeiRounded } from "@/lib/utils/amount";
import { useAtom } from "jotai";
import {
  ArrowUpDown,
  ChevronDown,
  MessageSquareWarning,
  OctagonAlert,
} from "lucide-react";
import { useAccount, useChainId } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import TokenDialog from "./token-dialog";
import type { SwapFormValues } from "@/features/swap/types";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import { parseInputExchangeAmount } from "@/features/swap/utils";
import { getTokenAddress } from "@/lib/config/tokens";
import { createPublicClient, http, formatUnits } from "viem";
import { celo } from "viem/chains";

type SwapDirection = "in" | "out";

const formSchema = z.object({
  amount: z.string().min(1, { message: "Amount is required" }),
  direction: z.enum(["in", "out"]),
  fromTokenId: z.string().min(1, { message: "From token is required" }),
  quote: z.string(),
  toTokenId: z.string().min(1, { message: "To token is required" }),
  slippage: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

// Default empty balances object
const defaultEmptyBalances = {};

export default function SwapForm() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [, setConfirmView] = useAtom(confirmViewAtom);

  const { data: balancesFromHook } = useAccountBalances({ address, chainId });

  const [, setFormValues] = useAtom(formValuesAtom);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      direction: "in" as SwapDirection,
      amount: "",
      quote: "",
      fromTokenId: "CELO",
      toTokenId: "cUSD",
      slippage: "0.5",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      setFormValues(values as SwapFormValues);
      setConfirmView(true);
    } catch (error) {
      console.error("Form submission error", error);
      // toast.error("Failed to submit the form. Please try again.");
    }
  }

  // Utility function to format numbers with max 6 decimals
  const formatWithMaxDecimals = (value: string, maxDecimals = 6): string => {
    if (!value || value === "0") return "0";
    const num = Number.parseFloat(value);
    if (Number.isNaN(num)) return "0";

    // If the number has more decimals than allowed, truncate it
    const factor = 10 ** maxDecimals;
    const truncated = Math.floor(num * factor) / factor;

    // Remove trailing zeros and return
    return truncated.toString();
  };

  const fromTokenId = useWatch({ control: form.control, name: "fromTokenId" });
  const toTokenId = useWatch({ control: form.control, name: "toTokenId" });
  const amount = useWatch({ control: form.control, name: "amount" });
  const formDirection = useWatch({ control: form.control, name: "direction" });
  const formQuote = useWatch({ control: form.control, name: "quote" });

  // Get token balances from the hook
  const balances = balancesFromHook || defaultEmptyBalances;
  const fromTokenBalance = useMemo(() => {
    const balanceValue = balances[fromTokenId as keyof typeof balances];
    const balance = fromWeiRounded(
      balanceValue,
      Tokens[fromTokenId as keyof typeof Tokens].decimals,
    );
    return formatWithMaxDecimals(balance || "0.00");
  }, [balances, fromTokenId]);
  const toTokenBalance = useMemo(() => {
    const balanceValue = balances[toTokenId as keyof typeof balances];
    const balance = fromWeiRounded(
      balanceValue,
      Tokens[toTokenId as keyof typeof Tokens].decimals,
    );
    return formatWithMaxDecimals(balance || "0.00");
  }, [balances, toTokenId]);

  // Check if amount exceeds balance
  const amountExceedsBalance = useMemo(() => {
    if (!amount || !fromTokenBalance || formDirection !== "in") return false;
    const numericAmount = Number.parseFloat(amount.replace(/,/g, ""));
    const numericBalance = Number.parseFloat(
      fromTokenBalance.replace(/,/g, ""),
    );
    return numericAmount > numericBalance;
  }, [amount, fromTokenBalance, formDirection]);

  // Function to handle token swap
  const handleReverseTokens = () => {
    const currentFromTokenId = form.getValues("fromTokenId");
    const currentToTokenId = form.getValues("toTokenId");
    const currentAmount = form.getValues("amount");

    // Swap token IDs
    form.setValue("fromTokenId", currentToTokenId);
    form.setValue("toTokenId", currentFromTokenId);

    // Keep the current amount value and direction as "in" (top field)
    form.setValue("amount", currentAmount);
    form.setValue("direction", "in");

    // Clear the quote to trigger recalculation
    form.setValue("quote", "");
  };

  const handleUseMaxBalance = () => {
    const maxAmountWei = balances[fromTokenId as keyof typeof balances] || "0";

    // Use the full balance amount
    const maxAmountBigInt = BigInt(maxAmountWei);
    const decimals = Tokens[fromTokenId as keyof typeof Tokens].decimals;

    const formattedAmount = fromWeiRounded(
      maxAmountBigInt.toString(),
      decimals,
    );
    form.setValue("amount", formatWithMaxDecimals(formattedAmount));
    form.setValue("direction", "in");

    // Show warning toast specifically for CELO token
    if (fromTokenId === "CELO") {
      toast.success("Max balance used", {
        duration: 5000,
        description: () => <>Consider keeping some CELO for transaction fees</>,
        icon: <OctagonAlert strokeWidth={1.5} size={18} className="mt-0.5" />,
      });
    }
  };

  // Function to calculate approximate USD value for a token amount
  const calculateUSDValue = useCallback(
    (amount: string, tokenId: string, currentRate?: string): string => {
      if (!amount || amount === "0" || !tokenId) return "0.00";

      const numericAmount = Number.parseFloat(amount);
      if (Number.isNaN(numericAmount) || numericAmount <= 0) return "0.00";

      // For USD-pegged stablecoins, use 1:1 conversion
      if (
        tokenId === "cUSD" ||
        tokenId === "USDC" ||
        tokenId === "USDT" ||
        tokenId === "axlUSDC"
      ) {
        return numericAmount.toFixed(2);
      }

      // For EUR-pegged tokens, approximate conversion (EUR is typically ~1.1 USD)
      if (tokenId === "cEUR") {
        return (numericAmount * 1.1).toFixed(2);
      }

      // For REAL-pegged tokens, approximate conversion (BRL is typically ~0.2 USD)
      if (tokenId === "cREAL") {
        return (numericAmount * 0.2).toFixed(2);
      }

      // For CELO and other tokens, use the rate if available
      // If we're calculating CELO value and we have a rate to cUSD
      if (
        tokenId === "CELO" &&
        currentRate &&
        (toTokenId === "cUSD" || fromTokenId === "cUSD")
      ) {
        // If CELO is fromToken and cUSD is toToken, rate is CELO/cUSD
        // So 1 CELO = (1/rate) cUSD
        if (fromTokenId === "CELO" && toTokenId === "cUSD") {
          const celoToCusdRate = currentRate ? 1 / Number(currentRate) : 0;
          return (numericAmount * celoToCusdRate).toFixed(2);
        }
        // If cUSD is fromToken and CELO is toToken, rate is cUSD/CELO
        // So 1 CELO = rate cUSD
        if (fromTokenId === "cUSD" && toTokenId === "CELO") {
          const celoToCusdRate = Number(currentRate);
          return (numericAmount * celoToCusdRate).toFixed(2);
        }
      }

      // For other tokens without direct rate to cUSD, return 0
      return "0.00";
    },
    [fromTokenId, toTokenId],
  );

  // Type assertion is needed because the form values are strings
  // but the hook expects specific types
  const { isLoading, quote, rate } = useSwapQuote(
    amount,
    formDirection as SwapDirection,
    fromTokenId as TokenId,
    toTokenId as TokenId,
  );

  // Calculate USD value for the receive amount
  const receiveUSDValue = useMemo(() => {
    const receiveAmount = formDirection === "out" ? amount : formQuote;
    const receiveTokenId = toTokenId;
    return calculateUSDValue(receiveAmount, receiveTokenId, rate);
  }, [formDirection, amount, formQuote, toTokenId, calculateUSDValue, rate]);

  // Calculate USD value for the sell amount
  const sellUSDValue = useMemo(() => {
    const sellAmount = formDirection === "in" ? amount : formQuote;
    const sellTokenId = fromTokenId;
    return calculateUSDValue(sellAmount, sellTokenId, rate);
  }, [formDirection, amount, formQuote, fromTokenId, calculateUSDValue, rate]);

  // Gas fee estimation
  const getPublicClient = (chainId: number) => {
    // Define chain configurations
    const alfajores = {
      id: 44787,
      name: "Alfajores",
      network: "alfajores",
      nativeCurrency: {
        decimals: 18,
        name: "Celo",
        symbol: "CELO",
      },
      rpcUrls: {
        default: {
          http: ["https://alfajores-forno.celo-testnet.org"],
        },
        public: {
          http: ["https://alfajores-forno.celo-testnet.org"],
        },
      },
      blockExplorers: {
        default: { name: "CeloScan", url: "https://alfajores.celoscan.io" },
      },
      testnet: true,
    };

    const baklava = {
      id: 62320,
      name: "Baklava",
      network: "baklava",
      nativeCurrency: {
        decimals: 18,
        name: "Celo",
        symbol: "CELO",
      },
      rpcUrls: {
        default: {
          http: ["https://baklava-forno.celo-testnet.org"],
        },
        public: {
          http: ["https://baklava-forno.celo-testnet.org"],
        },
      },
      blockExplorers: {
        default: { name: "CeloScan", url: "https://baklava.celoscan.io" },
      },
      testnet: true,
    };

    const chainMap = {
      42220: celo,
      44787: alfajores,
      62320: baklava,
    };

    const chain = chainMap[chainId as keyof typeof chainMap] || celo;

    return createPublicClient({
      chain,
      transport: http(),
    });
  };

  const {
    data: gasEstimate,
    isLoading: isGasEstimating,
    error: gasEstimateError,
  } = useQuery<{
    gasEstimate: bigint;
    feeData: {
      maxFeePerGas?: bigint;
      gasPrice?: bigint;
    };
    totalFeeWei: bigint;
    totalFeeFormatted: string;
  } | null>({
    queryKey: [
      "gas-estimate",
      amount,
      fromTokenId,
      toTokenId,
      formDirection,
      address,
      quote,
    ],
    queryFn: async () => {
      if (
        !address ||
        !amount ||
        !quote ||
        !fromTokenId ||
        !toTokenId ||
        Number.parseFloat(amount) <= 0 ||
        Number.parseFloat(quote) <= 0
      ) {
        return null;
      }

      try {
        const publicClient = getPublicClient(chainId);
        const sdk = await getMentoSdk(chainId);
        const fromTokenAddr = getTokenAddress(fromTokenId as TokenId, chainId);
        const toTokenAddr = getTokenAddress(toTokenId as TokenId, chainId);
        const tradablePair = await getTradablePairForTokens(
          chainId,
          fromTokenId as TokenId,
          toTokenId as TokenId,
        );

        const isSwapIn = formDirection === "in";
        const amountInWei = parseInputExchangeAmount(
          amount,
          fromTokenId as TokenId,
        );
        const quoteInWei = parseInputExchangeAmount(
          quote,
          toTokenId as TokenId,
        );

        // Apply slippage tolerance to prevent reverts on larger trades
        const slippageBps = Number(form.getValues("slippage") ?? "0.5") * 100;

        let thresholdAmountInWei: bigint;
        if (isSwapIn) {
          // For swapIn, reduce the minimum amount out by slippage
          thresholdAmountInWei = BigInt(
            (BigInt(quoteInWei) * BigInt(10000 - slippageBps)) / BigInt(10000),
          );
        } else {
          // For swapOut, increase the maximum amount in by slippage
          thresholdAmountInWei = BigInt(
            (BigInt(quoteInWei) * BigInt(10000 + slippageBps)) / BigInt(10000),
          );
        }

        const swapFn = isSwapIn ? sdk.swapIn.bind(sdk) : sdk.swapOut.bind(sdk);
        const txRequest = await swapFn(
          fromTokenAddr,
          toTokenAddr,
          amountInWei,
          thresholdAmountInWei,
          tradablePair,
        );

        console.log("Transaction request prepared:", {
          to: txRequest.to,
          gasLimit: txRequest.gasLimit?.toString(),
          value: txRequest.value?.toString(),
          fromToken: fromTokenId,
          toToken: toTokenId,
          amount: amount,
          quote: quote,
          slippageBps: slippageBps.toString(),
          thresholdAmount: thresholdAmountInWei.toString(),
        });

        if (!txRequest.to) {
          console.error("Transaction request missing 'to' address");
          return null;
        }

        // Use the gas limit from the SDK if available, otherwise estimate
        let estimatedGas: bigint;
        if (txRequest.gasLimit) {
          // Prefer SDK's gas limit as it's more reliable
          estimatedGas = BigInt(txRequest.gasLimit.toString());
        } else {
          try {
            estimatedGas = await publicClient.estimateGas({
              account: address,
              to: txRequest.to as `0x${string}`,
              data: txRequest.data as `0x${string}`,
              value: txRequest.value
                ? BigInt(txRequest.value.toString())
                : undefined,
            });
          } catch (gasError) {
            console.warn(
              "Gas estimation failed after successful simulation:",
              gasError,
            );
            // Use a reasonable fallback gas limit for swaps (typically 200k-300k gas)
            estimatedGas = BigInt(250000);
          }
        }

        // Get current gas price info
        const feeData = await publicClient.estimateFeesPerGas();

        // Calculate total fee using gas estimate + max fee per gas
        const totalFeeWei =
          estimatedGas *
          (feeData.maxFeePerGas || feeData.gasPrice || BigInt(0));

        // Convert to readable format (ETH/CELO)
        const totalFeeFormatted = formatUnits(totalFeeWei, 18);

        return {
          gasEstimate: estimatedGas,
          feeData,
          totalFeeWei,
          totalFeeFormatted,
        };
      } catch (error) {
        console.error("Gas estimation failed:", error);
        // Return null instead of throwing to prevent query from failing
        return null;
      }
    },
    enabled:
      !!address &&
      !!amount &&
      !!quote &&
      !!fromTokenId &&
      !!toTokenId &&
      Number.parseFloat(amount) > 0 &&
      Number.parseFloat(quote) > 0 &&
      !amountExceedsBalance, // Don't calculate gas if amount exceeds balance
    refetchInterval: 10000, // Refetch every 10 seconds to keep gas prices current
    retry: 1, // Limit retries for failed gas estimations
  });

  // Update the quote field when the calculated quote changes
  useEffect(() => {
    if (quote !== undefined && formQuote !== quote) {
      form.setValue("quote", quote, {
        shouldValidate: false,
        shouldDirty: false,
      });
    }
  }, [quote, formQuote, form]);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex h-full max-w-3xl flex-col gap-6"
      >
        <div className="flex flex-col gap-0">
          <div className="bg-incard dark:border-input border-border grid grid-cols-12 gap-4 border p-4">
            <div className="col-span-8">
              <Controller
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sell</FormLabel>
                    <FormControl>
                      <CoinInput
                        placeholder="0.00"
                        value={formDirection === "in" ? field.value : formQuote}
                        onChange={(e) => {
                          // Handle both string and event inputs
                          const val =
                            typeof e === "string" ? e : e.target.value;
                          field.onChange(val);
                          // When changing the sell field, ensure direction is set to "in"
                          if (formDirection !== "in") {
                            form.setValue("direction", "in", {
                              shouldValidate: true,
                            });
                          }
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      ~${formatWithMaxDecimals(sellUSDValue)}
                    </FormDescription>
                  </FormItem>
                )}
              />
            </div>

            <div className="col-span-4 flex flex-row items-center justify-end">
              <FormField
                control={form.control}
                name="fromTokenId"
                render={({ field }) => (
                  <FormItem className="flex flex-col items-end justify-end">
                    <FormControl>
                      <TokenDialog
                        value={field.value}
                        onValueChange={field.onChange}
                        title="Select asset to sell"
                        excludeTokenId={toTokenId}
                        trigger={
                          <button
                            type="button"
                            className="ring-offset-background placeholder:text-muted-foreground focus:ring-ring bg-outlier mt-[22px] flex h-10 w-full max-w-28 items-center justify-between rounded-none px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span>{field.value || "Select token"}</span>
                            <ChevronDown className="h-4 w-4 opacity-50" />
                          </button>
                        }
                      />
                    </FormControl>
                    <FormDescription className="w-[132px]">
                      Balance: {formatWithMaxDecimals(fromTokenBalance)}{" "}
                      <button
                        type="button"
                        className="cursor-pointer border-none bg-transparent p-0 text-inherit underline"
                        onClick={handleUseMaxBalance}
                      >
                        MAX
                      </button>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <div className="dark:border-input border-border flex w-full items-center justify-center border-x">
            <Button
              variant="outline"
              onClick={handleReverseTokens}
              size="icon"
              className="!border-y-0"
              type="button"
            >
              <ArrowUpDown
                className={cn(
                  "rotate-180 transition-transform",
                  formDirection === "in" ? "rotate-0" : "rotate-180",
                )}
              />
            </Button>
          </div>

          <div className="bg-incard dark:border-input border-border grid grid-cols-12 gap-4 border p-4">
            <div className="col-span-8">
              <Controller
                control={form.control}
                name="quote"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Buy</FormLabel>
                    <FormControl>
                      <CoinInput
                        placeholder="0.00"
                        value={formDirection === "out" ? amount : formQuote}
                        onChange={(e) => {
                          // Handle both string and event inputs
                          const val =
                            typeof e === "string" ? e : e.target.value;
                          // When changing this field, update amount and direction
                          form.setValue("amount", val, {
                            shouldValidate: true,
                          });
                          if (formDirection !== "out") {
                            form.setValue("direction", "out", {
                              shouldValidate: true,
                            });
                          }
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      ~${formatWithMaxDecimals(receiveUSDValue)}
                    </FormDescription>
                    <FormMessage>{fieldState.error?.message}</FormMessage>
                  </FormItem>
                )}
              />
            </div>

            <div className="col-span-4 flex flex-row items-center justify-end">
              <FormField
                control={form.control}
                name="toTokenId"
                render={({ field }) => (
                  <FormItem className="flex flex-col items-end justify-end">
                    <FormControl>
                      <TokenDialog
                        value={field.value}
                        onValueChange={field.onChange}
                        title="Select asset to buy"
                        excludeTokenId={fromTokenId}
                        trigger={
                          <button
                            type="button"
                            className="border-input ring-offset-background placeholder:text-muted-foreground focus:ring-ring bg-outlier mt-[22px] flex h-10 w-full max-w-28 items-center justify-between rounded-none px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span>{field.value || "Select token"}</span>
                            <ChevronDown className="h-4 w-4 opacity-50" />
                          </button>
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      Balance: {formatWithMaxDecimals(toTokenBalance)}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {rate &&
            (!isGasEstimating || amountExceedsBalance) &&
            !gasEstimateError && (
              <div className="flex w-full flex-col items-start justify-start space-y-2">
                <div className="flex w-full flex-row items-center justify-between">
                  <span className="text-muted-foreground">Quote</span>
                  <span>{`${rate && Number(rate) > 0 ? Number(rate).toFixed(4) : "0"} ${fromTokenId} ~ 1 ${toTokenId}`}</span>
                </div>
              </div>
            )}
          {rate &&
            gasEstimate &&
            !isGasEstimating &&
            !gasEstimateError &&
            !amountExceedsBalance && (
              <div className="flex w-full flex-col items-start justify-start space-y-2">
                <div className="flex w-full flex-row items-center justify-between">
                  <span className="text-muted-foreground">Fee</span>
                  <span>
                    {gasEstimate.totalFeeFormatted
                      ? formatWithMaxDecimals(gasEstimate.totalFeeFormatted)
                      : "0"}{" "}
                    CELO
                  </span>
                </div>
              </div>
            )}
          {gasEstimateError !== null && !amountExceedsBalance && (
            <div className="flex w-full flex-col items-start justify-start space-y-2">
              <div className="flex w-full flex-row items-center justify-between">
                <span className="text-muted-foreground">Fee</span>
                <span>Error estimating gas</span>
              </div>
            </div>
          )}
        </div>

        {isConnected ? (
          <Button
            clipped="lg"
            size="lg"
            className="mt-auto w-full"
            type="submit"
            variant={amountExceedsBalance ? "destructive" : "default"}
            disabled={
              isLoading ||
              !amount ||
              !quote ||
              amountExceedsBalance ||
              isGasEstimating
            }
          >
            {amountExceedsBalance
              ? "Insufficient Balance"
              : rate && isGasEstimating
                ? "Calculating transaction costs..."
                : isLoading
                  ? "Loading..."
                  : "Swap"}
          </Button>
        ) : (
          <ConnectButton size="lg" text="Connect" />
        )}
      </form>
    </Form>
  );
}
