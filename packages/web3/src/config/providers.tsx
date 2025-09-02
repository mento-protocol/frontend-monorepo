"use client";
import "@rainbow-me/rainbowkit/styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type PropsWithChildren, useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import type { State } from "wagmi";

const queryClient = new QueryClient({});

export function Web3Provider({
  children,
  initialState,
}: PropsWithChildren & { initialState: State | undefined }) {
  const [config, setConfig] = useState<any>(null);
  const [RainbowKitProvider, setRainbowKitProvider] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      import("./wagmi.client"),
      import("@rainbow-me/rainbowkit"),
    ]).then(([wagmiModule, rainbowModule]) => {
      setConfig(wagmiModule.wagmiClientConfig);
      setRainbowKitProvider(() => rainbowModule.RainbowKitProvider);
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
