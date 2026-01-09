"use client";
import { Logo } from "./logo.js";
import { Button } from "./ui/button.js";

export function Navigation() {
  return (
    <nav className="backdrop-blur-xs h-20 relative z-10 flex w-full items-center justify-between bg-background/30">
      <a href="https://mento.org">
        <div className="h-20 w-20 relative z-20">
          <Logo className="block h-full w-full" />
        </div>
      </a>
      <div className="gap-8 pr-4 pt-4 flex items-center">
        {/* <a
          href="https://governance.mento.org"
          className={cn(linkClassName, "hidden md:block")}
          target="_blank"
          rel="noopener noreferrer"
        >
          Governance
        </a> */}
        <a
          href="https://app.mento.org"
          target="_blank"
          rel="noopener noreferrer"
          className="md:mt-0 mt-auto w-full"
        >
          <Button clipped="sm" size="sm" className="px-4">
            Launch App
          </Button>
        </a>
      </div>
    </nav>
  );
}
