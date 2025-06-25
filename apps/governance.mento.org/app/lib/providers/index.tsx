"use client";

import { env } from "@/env.mjs";
import { CommunityCard, Footer, Navigation } from "@repo/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import type { ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
    },
  },
});

function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <Navigation />
      {children}
      <section className="xl:px-22 mb-8 w-full px-4 md:mb-20 md:px-20">
        <CommunityCard
          images={{
            mobile: `${env.NEXT_PUBLIC_STORAGE_URL}/Join Community CTA Mobile-Ry6dyO5vexptUPwsgDaemmhrMO0u8d.png`,
            desktop: `${env.NEXT_PUBLIC_STORAGE_URL}/Join Community CTA-nvhdeikuseiFmjssXcpQhq3aKFq4Ht.png`,
          }}
          buttonHref="http://discord.mento.org"
        />
      </section>

      <Footer type="governance" />
    </QueryProvider>
  );
}
