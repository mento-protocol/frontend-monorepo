"use client";

import React from "react";
import { useExplorerUrl } from "@repo/web3";

interface TransactionLinkProps {
  txHash: string;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Simple component that renders a clickable link to a transaction on the block explorer
 */
export function TransactionLink({
  txHash,
  children,
  className,
}: TransactionLinkProps) {
  const explorerUrl = useExplorerUrl();

  return (
    <a
      href={`${explorerUrl}/tx/${txHash}`}
      target="_blank"
      rel="noopener noreferrer"
      className={className || "underline-offset-4 hover:underline"}
    >
      {children || txHash}
    </a>
  );
}
