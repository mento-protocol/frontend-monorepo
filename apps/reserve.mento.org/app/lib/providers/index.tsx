"use client";

import type { ReactNode } from "react";
import type React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigation, ThemeProvider } from "@repo/ui";

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
    </QueryProvider>
  );
}
