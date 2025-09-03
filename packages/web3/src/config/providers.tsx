"use client";
import "@rainbow-me/rainbowkit/styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { type PropsWithChildren, useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import type { Config, State } from "wagmi";

const queryClient = new QueryClient({});

type RainbowKitProviderProps = Parameters<
  (typeof import("@rainbow-me/rainbowkit"))["RainbowKitProvider"]
>[0];

export function Web3Provider({
  children,
  initialState,
}: PropsWithChildren & { initialState: State | undefined }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [RainbowKitProvider, setRainbowKitProvider] =
    useState<React.ComponentType<RainbowKitProviderProps> | null>(null);

  useEffect(() => {
    Promise.all([
      import("./wagmi.client"),
      import("@rainbow-me/rainbowkit"),
    ]).then(([wagmiModule, rainbowModule]) => {
      setConfig(wagmiModule.wagmiClientConfig);
      setRainbowKitProvider(rainbowModule.RainbowKitProvider);
    });
  }, []);

  if (!config || !RainbowKitProvider) {
    return null;
  }

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
