"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  CopyToClipboard,
} from "@repo/ui";
import {
  useExplorerUrl,
  getExplorerUrl,
  shortenAddress,
  chainIdToSlug,
} from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import type { PoolDisplay } from "@repo/web3";
import { Info, ExternalLink, Link2, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface PoolAddressPopoverProps {
  pool: PoolDisplay;
  chainId?: number;
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

export function PoolAddressPopover({
  pool,
  chainId: overrideChainId,
}: PoolAddressPopoverProps) {
  const walletExplorerUrl = useExplorerUrl();
  const walletChainId = useChainId();
  const resolvedChainId = overrideChainId ?? walletChainId;
  const explorerUrl = overrideChainId
    ? getExplorerUrl(overrideChainId)
    : walletExplorerUrl;
  const [open, setOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const poolLink = `${typeof window !== "undefined" ? window.location.origin : ""}/pools/${chainIdToSlug(resolvedChainId) ?? "celo"}/${pool.poolAddr}`;

  const handleCopyLink = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      navigator.clipboard.writeText(poolLink);
      toast.success("Pool link copied", { duration: 2000 });
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // clipboard access denied
    }
  };

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="p-0 inline-flex cursor-help appearance-none border-0 bg-transparent"
          aria-label="View pool and token addresses"
        >
          <Info className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="space-y-2.5 w-fit animate-none [&>span]:hidden"
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
        <div className="h-px bg-border" />
        <button
          type="button"
          onClick={handleCopyLink}
          className="gap-1.5 text-xs font-medium p-0 flex cursor-pointer items-center border-0 bg-transparent text-muted-foreground transition-colors hover:text-foreground"
        >
          {linkCopied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Link2 className="h-3.5 w-3.5" />
          )}
          {linkCopied ? "Copied!" : "Copy pool link"}
        </button>
      </PopoverContent>
    </Popover>
  );
}
