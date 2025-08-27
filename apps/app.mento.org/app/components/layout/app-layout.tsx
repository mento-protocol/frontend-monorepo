"use client";

import { Footer } from "@repo/ui";
import { Header } from "@/components/nav/header";
import { PollingWorker } from "@repo/web3";
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
      <main className="relative z-20 my-auto h-full overflow-hidden pt-20 md:h-screen md:p-4 xl:h-[calc(100vh-80px)]">
        {children}
      </main>
      <Footer />
      {theme === "dark" ? (
        <Image
          src={`${env.NEXT_PUBLIC_STORAGE_URL}/app/bg-swap-dark.png`}
          alt="Mento Background"
          width={1440}
          height={720}
          className="fixed left-0 top-0 z-0 h-full w-full object-cover"
        />
      ) : (
        <Image
          src={`${env.NEXT_PUBLIC_STORAGE_URL}/app/bg-swap-light.png`}
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
