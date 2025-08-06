"use client";
import "@rainbow-me/rainbowkit/styles.css";

import type { PropsWithChildren } from "react";

import { ErrorBoundary } from "./errors";

import { Web3Provider } from "@repo/web3";
import { State } from "@repo/web3/wagmi";
import { useEffect, useState } from "react";

export function useIsSsr() {
  const [isSsr, setIsSsr] = useState(true);
  useEffect(() => {
    setIsSsr(false);
  }, []);
  return isSsr;
}

function SafeHydrate({ children }: PropsWithChildren<unknown>) {
  const isSsr = useIsSsr();
  if (isSsr) {
    return <div />;
  }
  return <>{children}</>;
}

export function ClientProviders({
  children,
  initialState,
}: PropsWithChildren & { initialState: State | undefined }) {
  return (
    <SafeHydrate>
      <Web3Provider initialState={initialState}>{children}</Web3Provider>
    </SafeHydrate>
  );
}
