"use client";

import { Navigation, Footer } from "@mento-protocol/ui";
import type { ReactNode } from "react";
import { QueryProvider } from "./query-provider";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <Navigation />
      {children}
      <Footer type="reserve" />
    </QueryProvider>
  );
}
