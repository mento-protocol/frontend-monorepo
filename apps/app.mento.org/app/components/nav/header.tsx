"use client";

import Link from "next/link";
import { ConnectButton } from "@/components/nav/connect-button";

import { ThemeSwitch } from "@/components/buttons/theme-switch";

export function Header() {
  return (
    <header className="relative z-30 w-screen px-3 pb-5 pt-4 sm:pl-5 sm:pr-6">
      <div className="flex items-center justify-between text-white">
        <Link href="/" className="flex items-center sm:hidden">
          Mento
        </Link>
        <Link href="/" className="hidden items-center sm:flex">
          Mento
        </Link>
        <ThemeSwitch />
        <ConnectButton />
      </div>
    </header>
  );
}
