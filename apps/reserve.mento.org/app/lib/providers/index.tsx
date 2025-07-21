"use client";

import { Navigation, Footer } from "@repo/ui";
import type { ReactNode } from "react";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <>
      <Navigation />
      {children}
      <Footer type="reserve" />
    </>
  );
}
