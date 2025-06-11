"use client";
import "@rainbow-me/rainbowkit/styles.css";

import { ThemeProvider as NextThemesProvider } from "next-themes";

import type { PropsWithChildren } from "react";

import { ErrorBoundary } from "./errors";
import { AppLayout } from "./layout/app-layout";

import { getWalletConnectors } from "@/lib/config/wallets";
import { useIsSsr } from "@/lib/utils/ssr";
import "@/lib/vendor/inpage-metamask";

import { Alfajores, Celo } from "@celo/rainbowkit-celo/chains";
import {
  RainbowKitProvider,
  connectorsForWallets,
} from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Analytics } from "@vercel/analytics/react";
import { WagmiConfig, configureChains, createClient } from "wagmi";
import { jsonRpcProvider } from "wagmi/providers/jsonRpc";

const reactQueryClient = new QueryClient({});

const { chains, provider } = configureChains(
  [Celo, Alfajores],
  [
    jsonRpcProvider({
      rpc: (chain) => ({ http: chain.rpcUrls.default.http[0] }),
    }),
  ],
);

const connectors = connectorsForWallets([
  {
    groupName: "Recommended for Celo chains",
    wallets: getWalletConnectors(chains),
  },
]);

const wagmiClient = createClient({
  autoConnect: true,
  provider,
  connectors,
});

function SafeHydrate({ children }: PropsWithChildren<unknown>) {
  const isSsr = useIsSsr();
  if (isSsr) {
    return <div />;
  }
  return <>{children}</>;
}

export function ClientProviders({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary>
      <SafeHydrate>
        <QueryClientProvider client={reactQueryClient}>
          <NextThemesProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
          >
            <WagmiConfig client={wagmiClient}>
              <RainbowKitProvider
                chains={chains}
                // theme={darkTheme({
                //   accentColor: Color.primary,
                //   borderRadius: "none",
                //   fontStack: "system",
                // })}
              >
                <AppLayout>{children}</AppLayout>
              </RainbowKitProvider>
            </WagmiConfig>
          </NextThemesProvider>
        </QueryClientProvider>
      </SafeHydrate>
      <Analytics />
    </ErrorBoundary>
  );
}
