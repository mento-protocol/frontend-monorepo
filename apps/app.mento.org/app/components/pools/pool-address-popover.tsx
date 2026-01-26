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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="p-0.5 rounded-sm transition-colors hover:bg-muted"
          aria-label="View pool and token addresses"
        >
          <Info className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="space-y-2.5 w-fit [&>span]:hidden"
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
