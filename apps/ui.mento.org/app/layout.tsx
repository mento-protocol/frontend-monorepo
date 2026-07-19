import "@mento-protocol/ui/globals.css";
import "./globals.css";

import type { Metadata } from "next";
import localFont from "next/font/local";

import { AppShell } from "./components/app-shell";

// Vendored locally (was next/font/google) so the production build is hermetic:
// no build-time Google Fonts fetch that could silently fall back to a different
// metric and shift every glyph — the #1 source of visual-regression flake.
const inter = localFont({
  src: "./fonts/InterVariable-latin.woff2",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mento UI Components",
  description: "Mento UI Components",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} data-vercel-phase-a-current="E">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
