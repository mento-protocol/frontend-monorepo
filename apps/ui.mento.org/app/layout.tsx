import "@repo/ui/globals.css";
import "./globals.css";

import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { AppShell } from "./components/app-shell";

const inter = Inter({ subsets: ["latin"] });

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
      <body className={inter.className}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
