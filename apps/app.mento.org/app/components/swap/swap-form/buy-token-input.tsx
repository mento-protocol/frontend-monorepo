"use client";

import { TokenIcon } from "@repo/ui";
import {
  CoinInput,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@repo/ui";
import { type TokenWithBalance, formatWithMaxDecimals } from "@repo/web3";
import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import { ChevronDown } from "lucide-react";
import { useCallback, type MutableRefObject, type RefObject } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import TokenDialog from "../token-dialog";
import type { FormValues } from "./types";
import { tokenButtonClassName } from "./types";

interface BuyTokenInputProps {
  form: UseFormReturn<FormValues>;
  direction: "in" | "out";
  setDirection: (d: "in" | "out") => void;
  quoteRef: RefObject<HTMLInputElement | null>;
  formQuote: string;
  latestRateRef: MutableRefObject<number | null>;
  buyUSDValue: string;
  toTokenBalance: string;
  tokenInSymbol: TokenSymbol;
  allTokenOptions: TokenWithBalance[];
  setLastChangedToken: (t: "from" | "to" | null) => void;
  handleUseMaxBuyBalance: () => void;
}

export function BuyTokenInput({
  form,
  direction,
  setDirection,
  quoteRef,
  formQuote,
  latestRateRef,
  buyUSDValue,
  toTokenBalance,
  tokenInSymbol,
  allTokenOptions,
  setLastChangedToken,
  handleUseMaxBuyBalance,
}: BuyTokenInputProps) {
  const handleBuyAmountChange = useCallback(
    (
      e: React.ChangeEvent<HTMLInputElement> | string,
      fieldOnChange: (value: string) => void,
    ) => {
      const value = typeof e === "string" ? e : e.target.value;
      fieldOnChange(value);
      if (direction !== "out") {
        setDirection("out");
      }

      const currentRate = latestRateRef.current;
      if (currentRate && currentRate > 0 && value && Number(value) > 0) {
        const estimatedSell = Number(value) * currentRate;
        if (Number.isFinite(estimatedSell) && estimatedSell < 1e18) {
          form.setValue(
            "amount",
            formatWithMaxDecimals(String(estimatedSell), 4, false),
            { shouldValidate: true },
          );
        }
      } else if (!value || Number(value) <= 0) {
        form.setValue("amount", "", { shouldValidate: true });
      }
    },
    [direction, setDirection, latestRateRef, form],
  );

  return (
    <div
      className="maybe-hover:border-border-secondary gap-4 p-4 grid grid-cols-12 border border-border bg-incard transition-colors focus-within:!border-primary dark:border-input dark:focus-within:!border-primary"
      onClick={() => {
        quoteRef.current?.focus();
      }}
    >
      <div className="col-span-8">
        <Controller
          control={form.control}
          name="quote"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>Buy</FormLabel>
              <FormControl>
                <CoinInput
                  ref={quoteRef}
                  data-testid="buyAmountInput"
                  placeholder="0"
                  value={
                    direction === "out"
                      ? (field.value ?? "")
                      : formQuote && formQuote !== "0" && formQuote !== "0.00"
                        ? formQuote
                        : ""
                  }
                  onChange={(e) => handleBuyAmountChange(e, field.onChange)}
                  onBlur={field.onBlur}
                />
              </FormControl>
              <FormDescription data-testid="buyUsdAmountLabel">
                ~${formatWithMaxDecimals(buyUSDValue)}
              </FormDescription>
              <FormMessage>{fieldState.error?.message}</FormMessage>
            </FormItem>
          )}
        />
      </div>

      <div className="col-span-4 flex flex-row items-center justify-end">
        <FormField
          control={form.control}
          name="tokenOutSymbol"
          render={({ field }) => (
            <FormItem className="flex flex-col items-end justify-end">
              <FormControl>
                <TokenDialog
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    setLastChangedToken("to");
                  }}
                  title="Select asset to buy"
                  excludeTokenSymbol={tokenInSymbol}
                  filterByTokenSymbol={tokenInSymbol}
                  onClose={() => {
                    setTimeout(() => {
                      quoteRef.current?.focus();
                    }, 500);
                  }}
                  trigger={
                    <button
                      type="button"
                      className={tokenButtonClassName}
                      data-testid="selectBuyTokenButton"
                    >
                      <TokenIcon
                        token={allTokenOptions.find(
                          (token) => token.symbol === field.value,
                        )}
                        className="mr-2"
                        size={20}
                      />
                      <span>{field.value || "Select"}</span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </button>
                  }
                />
              </FormControl>
              <FormDescription className="w-fit whitespace-nowrap">
                Balance: {toTokenBalance}{" "}
                <button
                  type="button"
                  className="p-0 cursor-pointer border-none bg-transparent text-inherit underline"
                  onClick={handleUseMaxBuyBalance}
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
  );
}
