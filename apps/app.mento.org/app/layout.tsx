import "./globals.css";

import { Geist, Geist_Mono } from "next/font/google";
import type { Metadata } from "next";
import { ClientProviders } from "./components/providers";
import localFont from "next/font/local";
import { env } from "../env.mjs";

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
  title: "Mento App",
  description:
    "Mento Protocol application for swapping and managing Celo assets.",
  openGraph: {
    images: [
      {
        url: `${env.NEXT_PUBLIC_STORAGE_URL}/og-general-8dXPy5tESVY2v45WUX8mP2CVbJfceA.png`,
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
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${aspekta.className} min-h-screen antialiased`}
      >
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
