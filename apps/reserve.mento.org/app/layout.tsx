import "./globals.css";
import "@repo/ui/globals.css";

import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Providers from "./lib/providers";
import { env } from "@/env.mjs";
import Image from "next/image";
import { CommunityCard } from "@repo/ui";

const aspekta = localFont({
  src: "./fonts/AspektaVF.ttf",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mento Reserve",
  description:
    "A basket of cryptocurrencies enabling the Mento protocol to expand and contract the supply of Mento stable assets in-line with user demand.",
  openGraph: {
    images: [
      {
        url: `${env.NEXT_PUBLIC_STORAGE_URL}/shared/og-general.png`,
        width: 1200,
        height: 630,
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${aspekta.className} max-w-screen dark overflow-x-hidden antialiased`}
      >
        <Providers>
          <main className="relative w-full pb-4">
            <Image
              src={`${env.NEXT_PUBLIC_STORAGE_URL}/reserve/hero-mobile.png`}
              alt="Mento Reserve"
              width={320}
              height={168}
              className="my-8 w-full md:hidden"
            />
            <Image
              src={`${env.NEXT_PUBLIC_STORAGE_URL}/reserve/hero.png`}
              alt="Mento Reserve"
              width={1280}
              height={640}
              className="absolute -bottom-[50px] -top-20 left-1/3 right-0 -z-10 hidden h-[660px] w-auto object-cover md:block 2xl:left-auto 2xl:right-0"
            />
            <section className="xl:px-22 max-w-2xl px-4 pb-0 md:pt-20">
              <h1 className="text-4xl font-medium md:text-6xl">
                Mento Reserve
              </h1>
              <p className="text-muted-foreground mt-2 max-w-[440px]">
                A diversified portfolio of crypto assets supporting the ability
                of the Mento Platform to expand and contract the supply of Mento
                stablecoins.
              </p>
            </section>
            {children}
            <CommunityCard />
          </main>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
