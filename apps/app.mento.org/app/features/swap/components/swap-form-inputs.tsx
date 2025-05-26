"use client";

import { useEffect } from "react";
import { TokenSelectField } from "@/components/input/token-select-field";
import type { AccountBalances } from "@/features/accounts/use-account-balances";
import {
  Controller,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormSetValue,
} from "react-hook-form";
import { toSignificant } from "@/lib/utils/amount"; // For formatting quote display

import { useSwapQuote } from "../hooks/use-swap-quote";
import { useTokenBalance } from "../hooks/use-token-balance";
import { useTokenOptions } from "../hooks/use-token-options";
import type { SwapFormValues } from "../types";

import { AmountField } from "./amount-field";
import { ReverseTokenButton } from "./reverse-token-button";
import { TokenSelectFieldWrapper } from "./token-select-field-wrapper";

interface Props {
  balances: AccountBalances;
  control: Control<SwapFormValues>;
  errors: FieldErrors<SwapFormValues>;
  setValue: UseFormSetValue<SwapFormValues>;
}

export function SwapFormInputs({ balances, control, errors, setValue }: Props) {
  const fromTokenId = useWatch({ control, name: "fromTokenId" });
  const toTokenId = useWatch({ control, name: "toTokenId" });
  const amount = useWatch({ control, name: "amount" }); // This is the primary amount input by user
  const formDirection = useWatch({ control, name: "direction" }); // Direction of user input
  const formQuote = useWatch({ control, name: "quote" }); // Calculated quote from useSwapQuote

  const { allTokenOptions, swappableTokens } = useTokenOptions(fromTokenId);
  const { balance, hasBalance, useMaxBalance } = useTokenBalance(
    balances,
    fromTokenId,
    setValue,
  );

  const {
    isLoading: isSwapQuoteLoading,
    quote: calculatedQuote,
    rate,
  } = useSwapQuote(
    amount, // always pass the 'amount' field which is user input
    formDirection, // pass the direction of the user input
    fromTokenId,
    toTokenId,
  );

  useEffect(() => {
    // If the calculated quote is different from the form's quote field, update it.
    // This handles updating the passive field.
    if (calculatedQuote !== undefined && formQuote !== calculatedQuote) {
      setValue("quote", calculatedQuote, {
        shouldValidate: false,
        shouldDirty: false,
      });
    }
  }, [calculatedQuote, formQuote, setValue]);

  // Determine the values for each AmountField based on direction
  const topAmountFieldValue = formDirection === "in" ? amount : formQuote; // If input is 'in', top field is 'amount', else it's 'quote'
  const bottomAmountFieldValue = formDirection === "out" ? amount : formQuote; // If input is 'out', bottom field is 'amount', else it's 'quote'

  return (
    <div className="flex flex-col gap-3">
      <TokenSelectFieldWrapper>
        <Controller
          name="fromTokenId"
          control={control}
          render={({ field }) => (
            <TokenSelectField
              {...field}
              label="From Token"
              tokenOptions={allTokenOptions}
            />
          )}
        />
        <div className="flex flex-col items-end">
          {hasBalance && (
            <button
              type="button"
              title="Use full balance"
              className="text-xs text-gray-500 hover:underline dark:text-[#AAB3B6]"
              onClick={useMaxBalance}
            >{`Use Max (${balance})`}</button>
          )}
          <Controller
            name="amount" // This is the field for 'from' amount or primary input
            control={control}
            render={({ field, fieldState }) => (
              <AmountField
                {...field} // value, onChange, onBlur, name, ref
                value={
                  formDirection === "in"
                    ? field.value
                    : calculatedQuote
                      ? toSignificant(calculatedQuote)
                      : ""
                } // Display field.value if active, else formatted quote
                onChange={(val) => field.onChange(val)} // Ensure RHF's onChange is called
                onFocus={() =>
                  setValue("direction", "in", { shouldValidate: true })
                }
                placeholder="0.00"
                showSpinner={isSwapQuoteLoading && formDirection === "in"}
                disabled={isSwapQuoteLoading && formDirection === "in"}
                error={fieldState.error?.message}
              />
            )}
          />
        </div>
      </TokenSelectFieldWrapper>
      <div className="flex items-center justify-between">
        <div className="ml-[70px] rounded-full bg-white transition-all hover:rotate-180 dark:bg-[#545457]">
          <ReverseTokenButton
            setValue={setValue}
            currentValues={{
              fromTokenId,
              toTokenId,
              amount,
              quote: formQuote,
              direction: formDirection,
              slippage: useWatch({ control, name: "slippage" }),
            }}
          />
        </div>
        <div className="flex items-center justify-end px-1.5 text-xs dark:text-[#AAB3B6]">
          {rate ? `${rate} ${fromTokenId} ~ 1 ${toTokenId}` : "..."}
        </div>
      </div>
      <TokenSelectFieldWrapper>
        <div className="flex items-center">
          <Controller
            name="toTokenId"
            control={control}
            render={({ field }) => (
              <TokenSelectField
                {...field}
                label="To Token"
                tokenOptions={swappableTokens}
              />
            )}
          />
        </div>
        <Controller
          name="quote" // This field represents the 'to' amount or the derived quote
          control={control}
          // rules={{ deps: ['amount', 'direction'] }} // Re-render if amount/direction changes
          render={({ field, fieldState }) => (
            <AmountField
              {...field}
              value={
                formDirection === "out"
                  ? useWatch({ control, name: "amount" })
                  : calculatedQuote
                    ? toSignificant(calculatedQuote)
                    : ""
              } // Display amount if active, else formatted quote
              onChange={(val) => {
                // If this field becomes active, 'amount' field should take this value
                // and direction should be 'out'
                setValue("amount", val, {
                  shouldValidate: true,
                  shouldDirty: true,
                });
                if (formDirection !== "out")
                  setValue("direction", "out", { shouldValidate: true });
                // field.onChange(val); // This updates the 'quote' field, which might not be desired if 'amount' is the source of truth
              }}
              onFocus={() => {
                if (formDirection !== "out")
                  setValue("direction", "out", { shouldValidate: true });
                // When focusing on the quote field, it implies we might want to input here.
                // The 'amount' field in the form state should then reflect this input.
                // The 'quote' field itself will be updated by the useEffect if it's passive.
                // For now, let's assume typing here means 'direction' is 'out' and 'amount' takes this value.
                setValue("amount", field.value || "", {
                  shouldValidate: true,
                  shouldDirty: true,
                });
              }}
              placeholder="0.00"
              showSpinner={isSwapQuoteLoading && formDirection === "out"}
              disabled={isSwapQuoteLoading && formDirection === "out"}
              error={fieldState.error?.message}
            />
          )}
        />
      </TokenSelectFieldWrapper>
    </div>
  );
}
