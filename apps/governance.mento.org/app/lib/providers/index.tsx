"use client";

import { env } from "@/env.mjs";
import { CommunityCard, Footer, IconCheck, Toaster } from "@repo/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useEffect, useState, type ReactNode } from "react";

import { Header } from "@/components/nav/header";
import { Celo } from "@/lib/config/chains";
import { wagmiConfig } from "@/lib/config/wagmi.config";
import { EnsureChain } from "@/lib/helpers/ensure-chain";
import { ApolloNextAppProvider } from "@apollo/experimental-nextjs-app-support/ssr";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { makeClient } from "../graphql/apollo.client";

const queryClient = new QueryClient();

export default function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <ApolloNextAppProvider makeClient={makeClient}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider initialChain={Celo}>
            {mounted && (
              <EnsureChain>
                <Toaster
                  position="top-right"
                  duration={5000}
                  icons={{
                    success: <IconCheck className="text-success" />,
                  }}
                  closeButton
                  toastOptions={{
                    classNames: {
                      toast: "toast",
                      title: "title",
                      description: "description",
                      actionButton: "action-button",
                      cancelButton: "cancel-button",
                      closeButton: "close-button",
                      icon: "icon",
                    },
                  }}
                  offset={{ top: "80px" }}
                  mobileOffset={{ top: "96px" }}
                />
                <Header />
                {children}
                <section className="xl:px-22 mb-8 w-full px-4 md:mb-20 md:px-20">
                  <CommunityCard
                    images={{
                      mobile: `${env.NEXT_PUBLIC_STORAGE_URL}/Join%20Community%20CTA%20Mobile-Ry6dyO5vexptUPwsgDaemmhrMO0u8d.png`,
                      desktop: `${env.NEXT_PUBLIC_STORAGE_URL}/Join%20Community%20CTA-nvhdeikuseiFmjssXcpQhq3aKFq4Ht.png`,
                    }}
                    buttonHref="http://discord.mento.org"
                  />
                </section>
                <Footer type="governance" />
              </EnsureChain>
            )}
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ApolloNextAppProvider>
  );
}
