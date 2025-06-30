"use client";

import { ConnectButton } from "../connect-button";

import { Logo } from "@repo/ui";

export function Header() {
  return (
    <header className="relative z-10">
      <div className="flex h-20 flex-row items-center justify-between gap-6">
        <a
          href="https://www.mento.org"
          className="flex items-center"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Mento.org"
        >
          <Logo />
        </a>
        <div className="flex flex-row items-center justify-between gap-2 px-4 md:px-6">
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
