"use client";

import React from "react";
import { useExplorerUrl } from "@repo/web3";

interface AddressLinkProps {
  address: string;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Simple component that renders a clickable link to an address on the block explorer
 */
export function AddressLink({
  address,
  children,
  className,
}: AddressLinkProps) {
  const explorerUrl = useExplorerUrl();

  return (
    <a
      href={`${explorerUrl}/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className={className || "font-bold underline-offset-4 hover:underline"}
    >
      {children || address}
    </a>
  );
}
