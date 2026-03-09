"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import { Info } from "lucide-react";
import { useState } from "react";

interface PoolFeePopoverProps {
  pool: PoolDisplay;
}

export function PoolFeePopover({ pool }: PoolFeePopoverProps) {
  const [open, setOpen] = useState(false);

  const feeLabel = pool.fees.label === "spread" ? "Spread" : "Fee";

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="p-0 inline-flex cursor-help appearance-none border-0 bg-transparent"
          aria-label={`View ${feeLabel.toLowerCase()} breakdown`}
        >
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="space-y-2 w-fit animate-none [&>span]:hidden"
      >
        <div className="gap-1 flex flex-col">
          <span className="text-xs font-medium text-foreground">
            {feeLabel} Breakdown
          </span>
        </div>
        <div className="h-px bg-border" />
        <div className="gap-1.5 flex flex-col">
          <div className="gap-4 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">LP Fee</span>
            <span className="text-xs font-mono font-medium">
              {pool.fees.lp.toFixed(2)}%
            </span>
          </div>
          <div className="gap-4 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Protocol Fee</span>
            <span className="text-xs font-mono font-medium">
              {pool.fees.protocol.toFixed(2)}%
            </span>
          </div>
          <div className="h-px bg-border" />
          <div className="gap-4 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">Total</span>
            <span className="text-xs font-mono font-medium">
              {pool.fees.total.toFixed(2)}%
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
