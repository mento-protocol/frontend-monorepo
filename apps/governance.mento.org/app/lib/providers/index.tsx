"use client";

import { env } from "@/env.mjs";
import { CommunityCard, Footer, IconCheck, Toaster } from "@repo/ui";
import { useEffect, useState, type ReactNode } from "react";

import { Header } from "@/components/nav/header";
import { EnsureChain } from "@/lib/helpers/ensure-chain";
import { ApolloNextAppProvider } from "@apollo/experimental-nextjs-app-support/ssr";
import { State, Web3Provider } from "@repo/web3";
import { makeClient } from "../graphql/apollo.client";

type ProvidersProps = {
  children: ReactNode;
  initialState: State | undefined;
};

export default function Providers({ children, initialState }: ProvidersProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <ApolloNextAppProvider makeClient={makeClient}>
      <Web3Provider initialState={initialState}>
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
                  closeButton: "close-button text-white! [&>svg]:text-white!",
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
      </Web3Provider>
    </ApolloNextAppProvider>
  );
}
