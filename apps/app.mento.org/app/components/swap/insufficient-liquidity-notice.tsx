"use client";

import { SWAP_INSUFFICIENT_LIQUIDITY_MESSAGE } from "@repo/web3";
import { AlertTriangle } from "lucide-react";

export function SwapInsufficientLiquidityNotice() {
  return (
    <div className="gap-2 border-amber-500/20 bg-amber-50/70 px-3 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300 flex items-start rounded-lg border">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{SWAP_INSUFFICIENT_LIQUIDITY_MESSAGE}</p>
    </div>
  );
}
