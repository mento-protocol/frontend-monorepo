"use client";

import { useState, useEffect } from "react";
import {
  Button,
  Card,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  TokenIcon,
  IconLoading,
} from "@repo/ui";
import { ArrowUpDown } from "lucide-react";
import { useAccount } from "wagmi";
import { useV3Swap, useV3SwapQuote } from "@/features/v3/hooks/use-v3-swap";
import { USDm, EURm } from "@/lib/config/tokens";

type Token = "USD.m" | "EUR.m";

export function V3SwapForm() {
  const { address } = useAccount();
  const [fromToken, setFromToken] = useState<Token>("USD.m");
  const [toToken, setToToken] = useState<Token>("EUR.m");
  const [amount, setAmount] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");

  const swapMutation = useV3Swap();
  const { getQuote } = useV3SwapQuote();

  // Get quote when amount changes
  useEffect(() => {
    if (amount && parseFloat(amount) > 0) {
      getQuote({ fromToken, toToken, amount }).then((quote) => {
        if (quote) {
          setExpectedOutput(quote.amountOutFormatted);
        } else {
          setExpectedOutput("");
        }
      });
    } else {
      setExpectedOutput("");
    }
  }, [amount, fromToken, toToken, getQuote]);

  const handleSwapTokens = () => {
    const tempToken = fromToken;
    setFromToken(toToken);
    setToToken(tempToken);
    setAmount("");
    setExpectedOutput("");
  };

  const handleSwap = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      return;
    }

    try {
      await swapMutation.mutateAsync({
        fromToken,
        toToken,
        amount,
      });

      // Clear form on success
      setAmount("");
      setExpectedOutput("");
    } catch (error) {
      // Error handling is done in the hook via toast
      console.error("Swap failed:", error);
    }
  };

  const getTokenConfig = (tokenSymbol: Token) => {
    return tokenSymbol === "USD.m" ? USDm : EURm;
  };

  const canSwap =
    amount &&
    parseFloat(amount) > 0 &&
    expectedOutput &&
    !swapMutation.isPending;

  if (!address) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <p className="text-slate-500">Connect your wallet to swap tokens.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-900">FPMM Swap</h2>
          <p className="text-slate-600">Swap tokens using FPMM pools</p>
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
                value={fromToken}
                onValueChange={(value: Token) => setFromToken(value)}
              >
                <SelectTrigger className="h-full w-full min-w-24 rounded-l-none border-l border-slate-300 bg-white px-4 text-slate-900">
                  <div className="flex items-center gap-2">
                    <TokenIcon token={getTokenConfig(fromToken)} size={20} />
                    <span className="text-slate-900">{fromToken}</span>
                  </div>
                </SelectTrigger>
                <SelectContent className="bg-white text-slate-900">
                  <SelectItem value="USD.m" className="hover:bg-slate-100">
                    <div className="flex items-center gap-2">
                      <TokenIcon token={USDm} size={16} />
                      USD.m
                    </div>
                  </SelectItem>
                  <SelectItem value="EUR.m" className="hover:bg-slate-100">
                    <div className="flex items-center gap-2">
                      <TokenIcon token={EURm} size={16} />
                      EUR.m
                    </div>
                  </SelectItem>
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
              value={expectedOutput}
              readOnly
            />
            <div className="absolute inset-y-0 right-0 flex items-center">
              <Select
                value={toToken}
                onValueChange={(value: Token) => setToToken(value)}
              >
                <SelectTrigger className="h-full w-full min-w-24 rounded-l-none border-l border-slate-300 bg-white px-4 text-slate-900">
                  <div className="flex items-center gap-2">
                    <TokenIcon token={getTokenConfig(toToken)} size={20} />
                    <span className="text-slate-900">{toToken}</span>
                  </div>
                </SelectTrigger>
                <SelectContent className="bg-white text-slate-900">
                  <SelectItem
                    value="USD.m"
                    className="hover:bg-slate-100"
                    disabled={fromToken === "USD.m"}
                  >
                    <div className="flex items-center gap-2">
                      <TokenIcon token={USDm} size={16} />
                      USD.m
                    </div>
                  </SelectItem>
                  <SelectItem
                    value="EUR.m"
                    className="hover:bg-slate-100"
                    disabled={fromToken === "EUR.m"}
                  >
                    <div className="flex items-center gap-2">
                      <TokenIcon token={EURm} size={16} />
                      EUR.m
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Swap Information */}
        {amount && expectedOutput && (
          <div className="rounded-lg bg-slate-50 p-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                {/* <span className="text-slate-600">Exchange Rate:</span>
                <span className="font-medium">
                  1 {fromToken} ≈{" "}
                  {(parseFloat(expectedOutput) / parseFloat(amount)).toFixed(6)}{" "}
                  {toToken}
                </span> */}
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">You pay:</span>
                <span className="font-medium">
                  {amount} {fromToken}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">You receive:</span>
                <span className="font-medium">
                  {expectedOutput} {toToken}
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
          ) : (
            `Swap ${fromToken} for ${toToken}`
          )}
        </Button>

        {/* Information Box */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="text-sm text-blue-800">
            <p className="mb-2 font-medium">FPMM Swap Information:</p>
            <ul className="space-y-1">
              <li>• This swap uses Fixed Product Market Maker (FPMM) pools</li>
              <li>
                • Tokens are transferred directly to the pool before swapping
              </li>
              <li>• Exchange rates are determined by pool reserves</li>
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}
