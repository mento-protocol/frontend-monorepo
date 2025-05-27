"use client";
import { useState } from "react";
import { Logo } from "./logo.js";
import { Button } from "./ui/button.js";

import { Menu, X } from "lucide-react";

const linkClassName = "text-muted-foreground text-base md:text-sm";

export function Navigation() {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <nav className="relative flex h-12 w-full items-center justify-between md:h-20">
      <div className="relative z-20 h-12 w-12 md:h-20 md:w-20">
        <Logo className="block h-full w-full" />
      </div>
      <Button
        variant="ghost"
        onClick={() => setIsOpen(!isOpen)}
        className="xs:block relative z-20 mr-4 md:hidden"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </Button>
      <div
        className={`${isOpen ? "translate-0" : "md:translate-0 -translate-x-full"} bg-background pt-18 absolute inset-0 z-10 flex h-[100dvh] flex-col items-start gap-8 p-6 transition-all duration-300 ease-in-out md:static md:h-20 md:flex-row md:items-center md:bg-transparent md:px-6 md:py-4 md:pt-4 md:transition-none`}
      >
        <a
          href="https://governance.mento.org"
          className={linkClassName}
          target="_blank"
          rel="noopener noreferrer"
        >
          Governance
        </a>
        <a
          href="https://mento.org/about"
          className={linkClassName}
          target="_blank"
          rel="noopener noreferrer"
        >
          About
        </a>
        <a
          href="https://app.mento.org"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto w-full md:mt-0"
        >
          <Button clipped="sm" size="sm" className="w-full">
            Launch App
          </Button>
        </a>
      </div>
    </nav>
  );
}
