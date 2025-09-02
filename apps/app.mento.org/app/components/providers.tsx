"use client";
import "@rainbow-me/rainbowkit/styles.css";

import { ThemeProvider as NextThemesProvider } from "next-themes";

import type { PropsWithChildren } from "react";

import { ErrorBoundary } from "./errors";
import { AppLayout } from "./layout/app-layout";

import { useIsSsr } from "@/lib/utils/ssr";

import { Web3Provider } from "@repo/web3";
import { State } from "@repo/web3/wagmi";

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
    <ErrorBoundary>
      <SafeHydrate>
        <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem>
          <Web3Provider initialState={initialState}>
            <AppLayout>{children}</AppLayout>
          </Web3Provider>
        </NextThemesProvider>
      </SafeHydrate>
    </ErrorBoundary>
  );
}
