"use client";

import { Navigation, Footer } from "@repo/ui";
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
