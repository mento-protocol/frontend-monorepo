"use client";

import { Footer } from "@/components/nav/footer";
import { Header } from "@/components/nav/header";
import { PollingWorker } from "@/features/polling/polling-worker";
import type { PropsWithChildren } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";

import "@repo/ui/globals.css";
import { env } from "../../../env.mjs";

export function AppLayout({ children }: PropsWithChildren) {
  const { theme } = useTheme();

  return (
    <>
      <Header />
      <main className="relative z-20 pt-20 md:p-4">{children}</main>
      <Footer />
      {theme === "dark" ? (
        <Image
          src={`${env.NEXT_PUBLIC_STORAGE_URL}/bg-swap-dark-FIraOueLKmMvdIYxmtdni8MLq8bjHF.png`}
          alt="Mento Background"
          width={1440}
          height={720}
          className="fixed left-0 top-0 z-0 h-full w-full object-cover"
        />
      ) : (
        <Image
          src={`${env.NEXT_PUBLIC_STORAGE_URL}/bg-swap-light-sJa3LVUfg33LU1iD5omWLA4zu41P7O.png`}
          alt="Mento Background"
          width={1440}
          height={720}
          className="fixed left-0 top-0 z-0 h-full w-full object-cover"
        />
      )}
      <PollingWorker />
    </>
  );
}
