"use client";
import "@rainbow-me/rainbowkit/styles.css";

import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type PropsWithChildren } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "./wagmi";
import type { State } from "wagmi";

const queryClient = new QueryClient({});

export function Web3Provider({
  children,
  initialState,
}: PropsWithChildren & { initialState: State | undefined }) {
  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
