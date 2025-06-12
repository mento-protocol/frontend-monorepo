"use client";
import { useState } from "react";
import { Logo } from "./logo.js";
import { Button } from "./ui/button.js";

import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils.js";

const linkClassName = "text-muted-foreground text-base md:text-sm";

export function Navigation() {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const handleToggle = () => {
    setIsOpen(!isOpen);
    document.body.classList.toggle("overflow-hidden", !isOpen);
  };

  return (
    <nav className="bg-background/30 backdrop-blur-xs relative z-10 flex h-20 w-full items-center justify-between">
      <a href="https://mento.org">
        <div className="relative z-20 h-20 w-20">
          <Logo className="block h-full w-full" />
        </div>
      </a>
      <div className="flex items-center gap-8 pr-4 pt-4">
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
          className="mt-auto w-full md:mt-0"
        >
          <Button clipped="sm" size="sm" className="px-4">
            Launch App
          </Button>
        </a>
      </div>
    </nav>
  );
}
