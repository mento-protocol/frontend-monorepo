import { parseAmount } from "@repo/web3";
import * as z from "zod";

export const formSchema = z.object({
  amount: z
    .string()
    .min(1, { message: "Amount is required" })
    .refine((v) => {
      if (v === "0." || v === "0") return true;
      const parsed = parseAmount(v);
      return parsed !== null && parsed.gt(0);
    }),
  tokenInSymbol: z.string().min(1, { message: "From token is required" }),
  quote: z.string(),
  tokenOutSymbol: z.string().min(1, { message: "To token is required" }),
  slippage: z.string().optional(),
});

export type FormValues = z.infer<typeof formSchema>;

export const defaultEmptyBalances = {};

export const tokenButtonClassName =
  "ring-offset-background placeholder:text-muted-foreground focus:ring-ring bg-outlier hover:border-border-secondary mt-[22px] flex h-10 w-full max-w-32 min-w-[116px] items-center justify-between gap-2 rounded-none border-solid border-1 border-[var(--border)] px-3 py-2 text-sm transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";
