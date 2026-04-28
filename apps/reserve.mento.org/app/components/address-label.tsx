"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

type AddressLabelVariant = "default" | "compact";

interface AddressLabelProps {
  label?: string;
  address?: string;
  identifier?: string;
  chain?: string;
  variant?: AddressLabelVariant;
  description?: string;
  /** Sentry tag for copy-failure breadcrumbs (e.g. "addresses_tab"). */
  context?: string;
  className?: string;
}

const ADDRESS_PATTERN =
  /^(0x[0-9a-fA-F]{40}|bc1[0-9a-z]{8,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;

function looksLikeAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value);
}

function truncateMiddle(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}\u2026${address.slice(-4)}`;
}

function explorerUrl(chain: string, address: string): string {
  if (chain === "bitcoin") {
    return `https://blockstream.info/address/${address}`;
  }
  return `https://debank.com/profile/${address}`;
}

function explorerTitle(chain: string): string {
  if (chain === "bitcoin") return "View address on Blockstream";
  return "View DeFi portfolio and positions on DeBank";
}

export function AddressLabel({
  label,
  address,
  identifier,
  chain,
  variant = "default",
  description,
  context,
  className,
}: AddressLabelProps) {
  const rawValue = address ?? identifier;
  const isAddress = !!rawValue && looksLikeAddress(rawValue);
  const displayAddress = isAddress ? rawValue : undefined;

  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (!displayAddress) return;
    try {
      await navigator.clipboard.writeText(displayAddress);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      Sentry.captureException(error, {
        tags: {
          feature: "reserve_address_copy",
          context: context ?? "unknown",
          chain: chain ?? "unknown",
        },
        extra: { address: displayAddress },
      });
    }
  };

  if (!displayAddress) {
    if (!label && !rawValue) return null;
    return (
      <span className={`gap-1 inline-flex items-baseline ${className ?? ""}`}>
        {label && <span className="font-medium">{label}</span>}
        {!label && rawValue && <span className="font-medium">{rawValue}</span>}
      </span>
    );
  }

  const truncated = truncateMiddle(displayAddress);
  const linkHref = chain ? explorerUrl(chain, displayAddress) : undefined;
  const linkTitle = chain ? explorerTitle(chain) : displayAddress;

  if (variant === "compact") {
    return (
      <span
        className={`group/address gap-2 inline-flex items-center ${className ?? ""}`}
      >
        {label && (
          <span className="text-sm font-medium text-foreground">{label}</span>
        )}
        {linkHref ? (
          <a
            href={linkHref}
            target="_blank"
            rel="noopener noreferrer"
            title={linkTitle}
            className="font-mono text-xs text-muted-foreground transition-colors hover:text-[#a855f7]"
          >
            {truncated}
          </a>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">
            {truncated}
          </span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy address ${displayAddress}`}
          className="h-3.5 w-3.5 rounded shrink-0 cursor-copy text-muted-foreground opacity-60 transition-opacity hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <ClipboardCopy className="h-3.5 w-3.5" />
          )}
        </button>
      </span>
    );
  }

  return (
    <div className={`group/address gap-0 flex flex-col ${className ?? ""}`}>
      {label && (
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
      )}
      <div className="gap-2 flex items-center">
        {linkHref ? (
          <a
            href={linkHref}
            target="_blank"
            rel="noopener noreferrer"
            title={linkTitle}
            className="font-mono text-sm break-all text-[#8c35fd] underline transition-colors hover:text-[#a855f7]"
          >
            {truncated}
          </a>
        ) : (
          <span className="font-mono text-sm break-all text-muted-foreground">
            {truncated}
          </span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy address ${displayAddress}`}
          className="h-4 w-4 rounded shrink-0 cursor-copy text-muted-foreground opacity-60 transition-opacity hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <ClipboardCopy className="h-4 w-4" />
          )}
        </button>
      </div>
      {description && (
        <span className="text-xs text-muted-foreground">{description}</span>
      )}
    </div>
  );
}
