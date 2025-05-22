"use client";
import { Logo } from "./logo.js";
import { Button } from "./ui/button.js";

const linkClassName = "text-muted-foreground text-sm";

export function Navigation() {
  return (
    <nav className="flex h-20 w-full items-center">
      <div className="flex gap-4">
        <Logo />
      </div>
      <div className="ml-auto flex items-center gap-8 p-6">
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
          className="ml-2"
        >
          <Button clipped="sm" size="sm">
            Launch App
          </Button>
        </a>
      </div>
    </nav>
  );
}
