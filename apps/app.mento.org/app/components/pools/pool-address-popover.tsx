"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  CopyToClipboard,
} from "@repo/ui";
import { useExplorerUrl, shortenAddress } from "@repo/web3";
import type { PoolDisplay } from "@repo/web3";
import { Info, ExternalLink } from "lucide-react";
import { useState, useRef, useCallback } from "react";

interface PoolAddressPopoverProps {
  pool: PoolDisplay;
}

interface AddressRowProps {
  label: string;
  address: string;
  explorerUrl: string;
}

function AddressRow({ label, address, explorerUrl }: AddressRowProps) {
  return (
    <div className="gap-1 flex flex-col">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <div className="gap-2 flex items-center">
        <span className="text-xs font-mono text-muted-foreground">
          {shortenAddress(address, false)}
        </span>
        <div className="gap-1 flex items-center">
          <CopyToClipboard
            text={address}
            toastMsg={`${label} address copied`}
            className="h-4 w-4 p-0"
          />
          <a
            href={`${explorerUrl}/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`View ${label} on block explorer`}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

export function PoolAddressPopover({ pool }: PoolAddressPopoverProps) {
  const explorerUrl = useExplorerUrl();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const handleOpen = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          className="cursor-help"
          aria-label="View pool and token addresses"
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
        >
          <Info className="h-4 w-4 text-muted-foreground" />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="space-y-2.5 w-fit [&>span]:hidden"
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
      >
        <AddressRow
          label="Pool"
          address={pool.poolAddr}
          explorerUrl={explorerUrl}
        />
        <div className="h-px bg-border" />
        <AddressRow
          label={pool.token0.name}
          address={pool.token0.address}
          explorerUrl={explorerUrl}
        />
        <div className="h-px bg-border" />
        <AddressRow
          label={pool.token1.name}
          address={pool.token1.address}
          explorerUrl={explorerUrl}
        />
      </PopoverContent>
    </Popover>
  );
}
