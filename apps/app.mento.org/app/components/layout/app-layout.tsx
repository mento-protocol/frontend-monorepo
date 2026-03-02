"use client";

import { Footer, IconCheck, Toaster } from "@repo/ui";
import { Header } from "@/components/nav/header";
import { Banner } from "@/components/layout/banner";
import { PollingWorker } from "@repo/web3";
import type { PropsWithChildren } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";

import "@repo/ui/globals.css";
import { env } from "@/env.mjs";

export function AppLayout({ children }: PropsWithChildren) {
  const { theme } = useTheme();

  return (
    <>
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
        style={{ zIndex: 9999 }}
      />
      <div className="flex h-screen flex-col overflow-hidden">
        <Banner />
        <Header />
        <main className="p-4 pt-6 md:pt-20 relative z-20 flex-1 overflow-hidden">
          {children}
        </main>
        <Footer />
      </div>
      {theme === "dark" ? (
        <Image
          src={`${env.NEXT_PUBLIC_STORAGE_URL}/app/bg-swap-dark.png`}
          alt="Mento Background"
          width={1440}
          height={720}
          className="left-0 top-0 fixed z-0 h-full w-full object-cover"
        />
      ) : (
        <Image
          src={`${env.NEXT_PUBLIC_STORAGE_URL}/app/bg-swap-light.png`}
          alt="Mento Background"
          width={1440}
          height={720}
          className="left-0 top-0 fixed z-0 h-full w-full object-cover"
        />
      )}
      <PollingWorker />
    </>
  );
}
