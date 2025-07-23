// Styles
import "@rainbow-me/rainbowkit/styles.css";
import "@repo/ui/globals.css";
import "./globals.css";

// Modules
import { Analytics } from "@vercel/analytics/react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";

import Providers from "./lib/providers";
import { wagmiConfig } from "./lib/config/wagmi.config";

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
  title: "Mento Governance",
  description:
    "A basket of cryptocurrencies enabling the Mento protocol to expand and contract the supply of Mento stable assets in-line with user demand.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialState = cookieToInitialState(
    wagmiConfig,
    (await headers()).get("cookie"),
  );
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${aspekta.className} max-w-screen dark overflow-x-hidden antialiased`}
      >
        <Providers initialState={initialState}>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
