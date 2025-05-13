import { Footer } from "@/components/nav/footer";
import { Header } from "@/components/nav/header";
import { PollingWorker } from "@/features/polling/polling-worker";
import type { PropsWithChildren } from "react";
import { Geist } from "next/font/google";

interface Props {
  pathName: string;
}

const geist = Geist({
  subsets: ["latin"],
});

export function AppLayout({ pathName, children }: PropsWithChildren<Props>) {
  return (
    <>
      <div
        className={`min-w-screen font-inter flex h-full min-h-screen w-full flex-col bg-neutral-900 ${geist.className}`}
      >
        <Header />
        <main className="relative z-20 flex h-[calc(100vh-184px-28px)] grow items-center justify-center">
          {children}
        </main>
        <Footer />
      </div>
      <PollingWorker />
    </>
  );
}
