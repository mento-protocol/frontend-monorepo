"use client";
import { useEffect, useMemo } from "react";

import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { cn } from "@repo/ui";

import { Button } from "@repo/ui";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@repo/ui";

import { CoinInput } from "@repo/ui";

import { useSwapQuote } from "@/features/swap/hooks/use-swap-quote";
import { ArrowUpDown, ChevronDown } from "lucide-react";
import TokenDialog from "./token-dialog";
import { useAccount, useChainId } from "wagmi";
import { useAccountBalances } from "@/features/accounts/use-account-balances";
import { ConnectButton } from "@/components/nav/connect-button";
import { fromWeiRounded } from "@/lib/utils/amount";
import { type TokenId, Tokens } from "@/lib/config/tokens";

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
  // Get user account and chain info
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  // Get account balances
  const { data: balancesFromHook } = useAccountBalances({ address, chainId });

  // TODO: In a production app, we would use these balances to display accurate token balances
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
      console.log(values);
      // toast(
      //   <pre className="mt-2 w-[340px] rounded-md bg-slate-950 p-4">
      //     <code className="text-white">{JSON.stringify(values, null, 2)}</code>
      //   </pre>,
      // );
    } catch (error) {
      console.error("Form submission error", error);
      // toast.error("Failed to submit the form. Please try again.");
    }
  }

  // Use useWatch to reactively get form values
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
    return balance || "0.00";
  }, [balances, fromTokenId]);
  const toTokenBalance = useMemo(() => {
    const balanceValue = balances[toTokenId as keyof typeof balances];
    const balance = fromWeiRounded(
      balanceValue,
      Tokens[toTokenId as keyof typeof Tokens].decimals,
    );
    return balance || "0.00";
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

  // Function to use max balance
  const handleUseMaxBalance = () => {
    // Use the actual balance from the hook
    const maxAmount = balances[fromTokenId as keyof typeof balances] || "0";
    form.setValue("amount", maxAmount.toString().replace(/,/g, ""));
    form.setValue("direction", "in");
  };

  // Type assertion is needed because the form values are strings
  // but the hook expects specific types
  const { isLoading, quote, rate } = useSwapQuote(
    amount,
    formDirection as SwapDirection,
    fromTokenId as TokenId,
    toTokenId as TokenId,
  );

  // Update the quote field when the calculated quote changes
  useEffect(() => {
    if (quote !== undefined && formQuote !== quote) {
      form.setValue("quote", quote, {
        shouldValidate: false,
        shouldDirty: false,
      });
    }
  }, [quote, formQuote, form]);

  // We'll use the direction to determine which field is active directly in the render function

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="mx-auto max-w-3xl space-y-6"
      >
        <div className="flex flex-col gap-0">
          <div className="bg-incard border-border grid grid-cols-12 gap-4 border p-4">
            <div className="col-span-6">
              <Controller
                control={form.control}
                name="amount"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Deposit</FormLabel>
                    <FormControl>
                      <CoinInput
                        placeholder="0.00"
                        type=""
                        value={formDirection === "in" ? field.value : formQuote}
                        onChange={(e) => {
                          // Handle both string and event inputs
                          const val =
                            typeof e === "string" ? e : e.target.value;
                          field.onChange(val);
                        }}
                        onFocus={() =>
                          form.setValue("direction", "in", {
                            shouldValidate: true,
                          })
                        }
                      />
                    </FormControl>
                    <FormDescription>~$0</FormDescription>
                  </FormItem>
                )}
              />
            </div>

            <div className="col-span-6 flex flex-row items-center justify-end">
              <FormField
                control={form.control}
                name="fromTokenId"
                render={({ field }) => (
                  <FormItem className="flex flex-col items-end justify-end">
                    <FormControl>
                      <TokenDialog
                        value={field.value}
                        onValueChange={field.onChange}
                        title="Select asset to deposit"
                        trigger={
                          <button
                            type="button"
                            className="border-input ring-offset-background placeholder:text-muted-foreground focus:ring-ring mt-[22px] flex h-10 w-full max-w-28 items-center justify-between rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span>{field.value || "Select token"}</span>
                            <ChevronDown className="h-4 w-4 opacity-50" />
                          </button>
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      Balance: {fromTokenBalance}{" "}
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

          <div className="border-border flex w-full items-center justify-center border-x">
            <Button
              variant="outline"
              onClick={handleReverseTokens}
              size="icon"
              className="!border-y-0"
            >
              <ArrowUpDown
                className={cn(
                  "rotate-180 transition-transform",
                  formDirection === "in" ? "rotate-0" : "rotate-180",
                )}
              />
            </Button>
          </div>

          <div className="bg-incard border-border grid grid-cols-12 gap-4 border p-4">
            <div className="col-span-6">
              <Controller
                control={form.control}
                name="quote"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Receive</FormLabel>
                    <FormControl>
                      <CoinInput
                        placeholder="0.00"
                        type=""
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
                        onFocus={() => {
                          form.setValue("direction", "out", {
                            shouldValidate: true,
                          });
                          // When focusing, ensure amount reflects this value
                          form.setValue("amount", field.value || "", {
                            shouldValidate: true,
                          });
                        }}
                      />
                    </FormControl>
                    <FormDescription>~$0</FormDescription>
                    <FormMessage>{fieldState.error?.message}</FormMessage>
                  </FormItem>
                )}
              />
            </div>

            <div className="col-span-6 flex flex-row items-center justify-end">
              <FormField
                control={form.control}
                name="toTokenId"
                render={({ field }) => (
                  <FormItem className="flex flex-col items-end justify-end">
                    <FormControl>
                      <TokenDialog
                        value={field.value}
                        onValueChange={field.onChange}
                        title="Select asset to receive"
                        trigger={
                          <button
                            type="button"
                            className="border-input ring-offset-background placeholder:text-muted-foreground focus:ring-ring mt-[22px] flex h-10 w-full max-w-28 items-center justify-between rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span>{field.value || "Select token"}</span>
                            <ChevronDown className="h-4 w-4 opacity-50" />
                          </button>
                        }
                      />
                    </FormControl>
                    <FormDescription>Balance: {toTokenBalance}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col items-start justify-start space-y-2">
          <div className="flex w-full flex-row items-center justify-between">
            <span className="text-muted-foreground">Quote</span>
            <span>
              {rate ? `1 ${fromTokenId} = ${rate} ${toTokenId}` : "Loading..."}
            </span>
          </div>
        </div>

        {isConnected ? (
          <Button
            clipped="lg"
            size="lg"
            className="w-full"
            type="submit"
            variant={amountExceedsBalance ? "destructive" : "default"}
            disabled={isLoading || !amount || !quote || amountExceedsBalance}
          >
            {amountExceedsBalance ? "Insufficient Balance" : "Swap"}
          </Button>
        ) : (
          <ConnectButton size="lg" text="Connect" />
        )}
      </form>
    </Form>
  );
}
