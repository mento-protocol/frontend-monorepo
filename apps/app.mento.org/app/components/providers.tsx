"use client";

import type { PropsWithChildren } from "react";
import { usePathname } from "next/navigation";

import { ErrorBoundary } from "./errors";
import { AppLayout } from "./layout/app-layout";

import { getWalletConnectors } from "@/lib/config/wallets";
import { Color } from "@/lib/styles/color";
import { useIsSsr } from "@/lib/utils/ssr";
import "@/lib/vendor/inpage-metamask";

import { Alfajores, Baklava, Celo } from "@celo/rainbowkit-celo/chains";
import {
  RainbowKitProvider,
  connectorsForWallets,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Analytics } from "@vercel/analytics/react";
import { ToastContainer, Zoom, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { WagmiConfig, configureChains, createClient } from "wagmi";
import { jsonRpcProvider } from "wagmi/providers/jsonRpc";

const reactQueryClient = new QueryClient({});

const { chains, provider } = configureChains(
  [Celo, Alfajores, Baklava],
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
  const pathName = usePathname();

  return (
    <ErrorBoundary>
      <SafeHydrate>
        <QueryClientProvider client={reactQueryClient}>
          <WagmiConfig client={wagmiClient}>
            <RainbowKitProvider
              chains={chains}
              theme={lightTheme({
                accentColor: Color.primary,
                borderRadius: "none",
                fontStack: "system",
              })}
            >
              <AppLayout pathName={pathName}>{children}</AppLayout>
              <ToastContainer
                transition={Zoom}
                position={toast.POSITION.BOTTOM_RIGHT}
                limit={2}
              />
            </RainbowKitProvider>
          </WagmiConfig>
        </QueryClientProvider>
      </SafeHydrate>
      <Analytics />
    </ErrorBoundary>
  );
}
