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

interface SellTokenInputProps {
  form: UseFormReturn<FormValues>;
  amountRef: RefObject<HTMLInputElement | null>;
  validateAmount: (value: string) => Promise<string | true>;
  sellUSDValue: string;
  fromTokenBalance: string;
  handleUseMaxBalance: () => void;
  tokenOutSymbol: TokenSymbol;
  allTokenOptions: TokenWithBalance[];
  setLastChangedToken: (t: "from" | "to" | null) => void;
}

export function SellTokenInput({
  form,
  amountRef,
  validateAmount,
  sellUSDValue,
  fromTokenBalance,
  handleUseMaxBalance,
  tokenOutSymbol,
  allTokenOptions,
  setLastChangedToken,
}: SellTokenInputProps) {
  return (
    <div
      className="maybe-hover:border-border-secondary gap-4 p-4 grid grid-cols-12 border border-border bg-incard transition-colors focus-within:!border-primary dark:border-input dark:focus-within:!border-primary"
      onClick={() => {
        amountRef.current?.focus();
      }}
    >
      <div className="col-span-8">
        <Controller
          control={form.control}
          name="amount"
          rules={{
            validate: validateAmount,
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Sell</FormLabel>
              <FormControl>
                <CoinInput
                  ref={amountRef}
                  data-testid="sellAmountInput"
                  placeholder="0"
                  value={field.value}
                  onChange={(e) => {
                    const val = typeof e === "string" ? e : e.target.value;
                    field.onChange(val);
                  }}
                  onBlur={field.onBlur}
                />
              </FormControl>
              <FormDescription data-testid="sellUsdAmountLabel">
                ~${formatWithMaxDecimals(sellUSDValue)}
              </FormDescription>
            </FormItem>
          )}
        />
      </div>

      <div className="col-span-4 flex flex-row items-center justify-end">
        <FormField
          control={form.control}
          name="tokenInSymbol"
          render={({ field }) => (
            <FormItem className="flex flex-col items-end justify-end">
              <FormControl>
                <TokenDialog
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    setLastChangedToken("from");
                  }}
                  title="Select asset to sell"
                  excludeTokenSymbol={tokenOutSymbol}
                  filterByTokenSymbol={tokenOutSymbol}
                  onClose={() => {
                    setTimeout(() => {
                      amountRef.current?.focus();
                    }, 500);
                  }}
                  trigger={
                    <button
                      type="button"
                      className={tokenButtonClassName}
                      data-testid="selectSellTokenButton"
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
                Balance: {fromTokenBalance}{" "}
                <button
                  type="button"
                  className="p-0 cursor-pointer border-none bg-transparent text-inherit underline"
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
  );
}
