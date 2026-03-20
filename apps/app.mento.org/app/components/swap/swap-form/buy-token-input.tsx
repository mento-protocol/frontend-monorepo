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
import type { RefObject } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import TokenDialog from "../token-dialog";
import type { FormValues } from "./types";
import { tokenButtonClassName } from "./types";

interface BuyTokenInputProps {
  form: UseFormReturn<FormValues>;
  quoteRef: RefObject<HTMLInputElement | null>;
  formQuote: string;
  buyUSDValue: string;
  toTokenBalance: string;
  chainId: number;
  tokenInSymbol: TokenSymbol;
  allTokenOptions: TokenWithBalance[];
  setLastChangedToken: (t: "from" | "to" | null) => void;
}

export function BuyTokenInput({
  form,
  quoteRef,
  formQuote,
  buyUSDValue,
  toTokenBalance,
  chainId,
  tokenInSymbol,
  allTokenOptions,
  setLastChangedToken,
}: BuyTokenInputProps) {
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
                    formQuote && formQuote !== "0" && formQuote !== "0.00"
                      ? formQuote
                      : ""
                  }
                  readOnly
                  disabled
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
                  chainId={chainId}
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
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                    </button>
                  }
                />
              </FormControl>
              <FormDescription className="w-fit whitespace-nowrap">
                Balance: {toTokenBalance}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
