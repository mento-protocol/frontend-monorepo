// Styles
import "@rainbow-me/rainbowkit/styles.css";
import "@repo/ui/globals.css";
import "./globals.css";

// Modules
import { ApolloProvider, wagmiConfig } from "@repo/web3";
import { cookieToInitialState } from "@repo/web3/wagmi";
import { Analytics } from "@vercel/analytics/react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { ClientProviders } from "./components/providers";
import { env } from "./env.mjs";
import { Header } from "./components/nav/header";
import { CommunityCard, Footer, IconCheck, Toaster } from "@repo/ui";

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
  openGraph: {
    images: [
      {
        url: `${env.NEXT_PUBLIC_STORAGE_URL}/og-general.png`,
        width: 1200,
        height: 630,
      },
    ],
  },
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
        <ClientProviders initialState={initialState}>
          <ApolloProvider>
            <Header />
            {children}
            <section className="xl:px-22 mb-8 w-full px-4 md:mb-20 md:px-20">
              <CommunityCard
                images={{
                  mobile: `${env.NEXT_PUBLIC_STORAGE_URL}/Join Community CTA Mobile-Ry6dyO5vexptUPwsgDaemmhrMO0u8d.png`,
                  desktop: `${env.NEXT_PUBLIC_STORAGE_URL}/Join Community CTA-nvhdeikuseiFmjssXcpQhq3aKFq4Ht.png`,
                }}
                buttonHref="http://discord.mento.org"
              />
            </section>
            <Footer type="governance" />
          </ApolloProvider>
        </ClientProviders>
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
        />
        <Analytics />
      </body>
    </html>
  );
}
