"use client";
import "@rainbow-me/rainbowkit/styles.css";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { PropsWithChildren } from "react";
import { ErrorBoundary } from "./errors";
import { AppLayout } from "./layout/app-layout";

import { useIsSsr } from "@repo/ui";
import { Web3Provider } from "@repo/web3";
import { State } from "@repo/web3/wagmi";
import { useSentryWalletContext } from "@/hooks/use-sentry-wallet-context";

function SafeHydrate({ children }: PropsWithChildren<unknown>) {
  const isSsr = useIsSsr();
  if (isSsr) {
    return <div />;
  }
  return <>{children}</>;
}

function WalletContextTracker() {
  useSentryWalletContext();
  return null;
}

export function ClientProviders({
  children,
  initialState,
}: PropsWithChildren & { initialState: State | undefined }) {
  return (
    <ErrorBoundary>
      <SafeHydrate>
        <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem>
          <Web3Provider initialState={initialState}>
            <WalletContextTracker />
            <AppLayout>{children}</AppLayout>
          </Web3Provider>
        </NextThemesProvider>
      </SafeHydrate>
    </ErrorBoundary>
  );
}
