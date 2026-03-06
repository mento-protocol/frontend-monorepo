"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  CopyToClipboard,
} from "@repo/ui";
import { Info } from "lucide-react";
import { useState } from "react";

function shortenId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

interface TroveIdPopoverProps {
  troveId: string;
}

export function TroveIdPopover({ troveId }: TroveIdPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="p-0 inline-flex cursor-help appearance-none border-0 bg-transparent"
          aria-label="View trove ID"
        >
          <Info className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="space-y-1.5 w-fit animate-none [&>span]:hidden"
      >
        <p className="text-xs font-medium text-foreground">Trove ID</p>
        <div className="gap-2 flex items-center">
          <span className="text-xs font-mono text-muted-foreground">
            {shortenId(troveId)}
          </span>
          <CopyToClipboard
            text={troveId}
            toastMsg="Trove ID copied"
            className="h-4 w-4 p-0"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
