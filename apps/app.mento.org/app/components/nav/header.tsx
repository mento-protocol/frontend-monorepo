"use client";

import Link from "next/link";
import { ConnectButton } from "@/components/nav/connect-button";

import { ThemeSwitch } from "@/components/buttons/theme-switch";

import Logo from "@/components/logo";

export function Header() {
  return (
    <header className="relative z-10">
      <div className="flex h-20 flex-row items-center justify-between gap-6">
        <Link href="/" className="flex items-center sm:hidden">
          <Logo />
        </Link>
        <div className="flex flex-row items-center justify-between gap-2 px-6">
          <ThemeSwitch />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
