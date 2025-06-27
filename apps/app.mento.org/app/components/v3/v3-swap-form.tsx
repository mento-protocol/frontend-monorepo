"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Button,
  Card,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TokenIcon,
  IconLoading,
} from "@repo/ui";
import { ArrowUpDown } from "lucide-react";
import { useAccount } from "wagmi";
import { useV3Swap, useV3SwapQuote } from "@/features/v3/hooks/use-v3-swap";
import {
  useV3FPMMPools,
  TokenInfo,
} from "@/features/v3/hooks/use-v3-fpmm-pools";

export function V3SwapForm() {
  const { address } = useAccount();
  const [fromToken, setFromToken] = useState<TokenInfo | null>(null);
  const [toToken, setToToken] = useState<TokenInfo | null>(null);
  const [amount, setAmount] = useState("");

  // Fetch all available FPMM pools and tokens
  const { data: poolsData, isLoading: isLoadingPools } = useV3FPMMPools();

  // Get swap hook and quote hook
  const swapMutation = useV3Swap();

  // Quote logic with proper token addresses - only when amount is valid
  const shouldGetQuote =
    amount && parseFloat(amount) > 0 && fromToken && toToken;
  const { data: quoteData, isLoading: isLoadingQuote } = useV3SwapQuote(
    shouldGetQuote ? fromToken.address : undefined,
    shouldGetQuote ? toToken.address : undefined,
    shouldGetQuote ? amount : undefined,
  );

  // Set default tokens when pools data loads
  useEffect(() => {
    if (poolsData && poolsData.allTokens.length > 0 && !fromToken) {
      const defaultFromToken = poolsData.allTokens[0];
      setFromToken(defaultFromToken);

      // Set default to token if available
      const availableOutputs =
        poolsData.tokenMapping[defaultFromToken.address]?.availableOutputs;
      if (availableOutputs && availableOutputs.length > 0) {
        setToToken(availableOutputs[0].token);
      }
    }
  }, [poolsData, fromToken]);

  // Get available output tokens based on selected input token
  const availableOutputTokens = useMemo(() => {
    if (!fromToken || !poolsData) return [];

    const inputTokenMapping = poolsData.tokenMapping[fromToken.address];
    return inputTokenMapping?.availableOutputs || [];
  }, [fromToken, poolsData]);

  // Update output token when input token changes
  useEffect(() => {
    if (fromToken && availableOutputTokens.length > 0) {
      // If current toToken is not available for this fromToken, select the first available
      const isCurrentToTokenAvailable = availableOutputTokens.some(
        (output) => output.token.address === toToken?.address,
      );

      if (!isCurrentToTokenAvailable) {
        setToToken(availableOutputTokens[0].token);
      }
    }
  }, [fromToken, availableOutputTokens, toToken]);

  const handleSwapTokens = () => {
    if (fromToken && toToken) {
      setFromToken(toToken);
      setToToken(fromToken);
      setAmount("");
    }
  };

  const handleFromTokenChange = (tokenAddress: string) => {
    if (!poolsData) return;

    const selectedToken = poolsData.allTokens.find(
      (token) => token.address === tokenAddress,
    );
    if (selectedToken) {
      setFromToken(selectedToken);
      setAmount(""); // Clear amount when changing tokens
    }
  };

  const handleToTokenChange = (tokenAddress: string) => {
    const selectedOutput = availableOutputTokens.find(
      (output) => output.token.address === tokenAddress,
    );
    if (selectedOutput) {
      setToToken(selectedOutput.token);
    }
  };

  const handleSwap = async () => {
    if (
      !amount ||
      parseFloat(amount) <= 0 ||
      !fromToken ||
      !toToken ||
      !quoteData
    ) {
      return;
    }

    try {
      await swapMutation.mutateAsync({
        tokenInAddress: fromToken.address,
        tokenOutAddress: toToken.address,
        amountIn: amount,
        amountOut: quoteData.amountOut,
      });

      // Clear form on success
      setAmount("");
    } catch (error) {
      // Error handling is done in the hook via toast
      console.error("Swap failed:", error);
    }
  };

  const canSwap =
    amount &&
    parseFloat(amount) > 0 &&
    fromToken &&
    toToken &&
    quoteData &&
    !swapMutation.isPending &&
    !isLoadingQuote;

  if (!address) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <p className="text-slate-500">Connect your wallet to swap tokens.</p>
        </div>
      </Card>
    );
  }

  if (isLoadingPools) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <IconLoading />
            <p className="text-slate-500">Loading available pools...</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!poolsData || poolsData.allTokens.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <p className="text-slate-500">No FPMM pools available.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-900">FPMM Swap</h2>
          <p className="text-slate-600">
            Swap tokens using Fixed Product Market Maker pools
          </p>
        </div>

        {/* From Token */}
        <div className="space-y-2">
          <Label
            htmlFor="fromAmount"
            className="text-sm font-medium text-slate-900"
          >
            From
          </Label>
          <div className="relative">
            <Input
              id="fromAmount"
              type="number"
              placeholder="0.00"
              className="h-16 pr-32 text-2xl"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="absolute inset-y-0 right-0 flex items-center">
              <Select
                value={fromToken?.address || ""}
                onValueChange={handleFromTokenChange}
              >
                <SelectTrigger className="h-full w-full min-w-32 rounded-l-none border-l border-slate-300 bg-white px-4 text-slate-900">
                  <div className="flex items-center gap-2">
                    {fromToken && (
                      <>
                        <TokenIcon token={fromToken} size={20} />
                        <span className="text-slate-900">
                          {fromToken.symbol}
                        </span>
                      </>
                    )}
                    {!fromToken && <SelectValue placeholder="Select token" />}
                  </div>
                </SelectTrigger>
                <SelectContent className="max-h-60 bg-white text-slate-900">
                  {poolsData.allTokens.map((token) => (
                    <SelectItem
                      key={token.address}
                      value={token.address}
                      className="hover:bg-slate-100"
                    >
                      <div className="flex items-center gap-2">
                        <TokenIcon token={token} size={16} />
                        <span>{token.symbol}</span>
                        <span className="text-xs text-slate-500">
                          ({token.name})
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Swap Direction Button */}
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="icon"
            onClick={handleSwapTokens}
            className="h-10 w-10 rounded-full"
            disabled={!fromToken || !toToken}
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </div>

        {/* To Token */}
        <div className="space-y-2">
          <Label
            htmlFor="toAmount"
            className="text-sm font-medium text-slate-900"
          >
            To (Estimated)
          </Label>
          <div className="relative">
            <Input
              id="toAmount"
              type="text"
              placeholder="0.00"
              className="h-16 pr-32 text-2xl"
              value={
                !shouldGetQuote
                  ? ""
                  : isLoadingQuote
                    ? "Loading..."
                    : quoteData?.amountOut || ""
              }
              readOnly
            />
            <div className="absolute inset-y-0 right-0 flex items-center">
              <Select
                value={toToken?.address || ""}
                onValueChange={handleToTokenChange}
                disabled={availableOutputTokens.length === 0}
              >
                <SelectTrigger className="h-full w-full min-w-32 rounded-l-none border-l border-slate-300 bg-white px-4 text-slate-900">
                  <div className="flex items-center gap-2">
                    {toToken && (
                      <>
                        <TokenIcon token={toToken} size={20} />
                        <span className="text-slate-900">{toToken.symbol}</span>
                      </>
                    )}
                    {!toToken && <SelectValue placeholder="Select token" />}
                  </div>
                </SelectTrigger>
                <SelectContent className="max-h-60 bg-white text-slate-900">
                  {availableOutputTokens.map((output) => (
                    <SelectItem
                      key={output.token.address}
                      value={output.token.address}
                      className="hover:bg-slate-100"
                    >
                      <div className="flex items-center gap-2">
                        <TokenIcon token={output.token} size={16} />
                        <span>{output.token.symbol}</span>
                        <span className="text-xs text-slate-500">
                          ({output.token.name})
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {fromToken && availableOutputTokens.length === 0 && (
            <p className="text-xs text-slate-500">
              No trading pairs available for {fromToken.symbol}
            </p>
          )}
        </div>

        {/* Swap Information */}
        {amount && quoteData && fromToken && toToken && (
          <div className="rounded-lg bg-slate-50 p-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">You pay:</span>
                <span className="font-medium">
                  {amount} {fromToken.symbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">You receive (min):</span>
                <span className="font-medium">
                  {quoteData.minimumAmountOut} {toToken.symbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Expected output:</span>
                <span className="font-medium">
                  {quoteData.amountOut} {toToken.symbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Price impact:</span>
                <span className="font-medium text-green-600">
                  ~{quoteData.priceImpact}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Swap Button */}
        <Button
          onClick={handleSwap}
          className="h-12 w-full text-lg"
          disabled={!canSwap}
        >
          {swapMutation.isPending ? (
            <div className="flex items-center gap-2">
              <IconLoading />
              Swapping...
            </div>
          ) : isLoadingQuote && shouldGetQuote ? (
            <div className="flex items-center gap-2">
              <IconLoading />
              Getting quote...
            </div>
          ) : !fromToken || !toToken ? (
            "Select tokens to swap"
          ) : availableOutputTokens.length === 0 ? (
            "No trading pairs available"
          ) : (
            `Swap ${fromToken?.symbol || ""} for ${toToken?.symbol || ""}`
          )}
        </Button>

        {/* Information Box */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="text-sm text-blue-800">
            <p className="mb-2 font-medium">FPMM Swap Information:</p>
            <ul className="space-y-1">
              <li>
                • Uses Fixed Product Market Maker (FPMM) pools for swapping
              </li>
              <li>
                • Pools are automatically discovered from the factory contract
              </li>
              <li>
                • Swap rates are based on oracle prices with minimal slippage
              </li>
              <li>• Available token pairs depend on deployed FPMM pools</li>
            </ul>
          </div>
        </div>

        {/* Pool Information */}
        {poolsData && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm text-slate-600">
              <p className="mb-2 font-medium">Available Pools:</p>
              <div className="space-y-1">
                {poolsData.pools.map((pool) => (
                  <div key={pool.address} className="flex justify-between">
                    <span>
                      {pool.token0.symbol}/{pool.token1.symbol}
                    </span>
                    <span className="font-mono text-xs">
                      {pool.address.slice(0, 6)}...{pool.address.slice(-4)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
