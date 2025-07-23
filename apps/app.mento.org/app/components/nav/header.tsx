"use client";

import { ConnectButton } from "@repo/web3";

import { useTheme } from "next-themes";
import { Button, cn, Logo } from "@repo/ui";
import { Moon, Sun } from "lucide-react";

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="switch"
      size="switch"
      className=""
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
    >
      <div
        className={cn(
          "peer/sun relative z-10 flex h-[30px] w-[30px] flex-row items-center justify-center transition-colors",
          theme === "light"
            ? "bg-card text-foreground peer-hover/moon:text-muted-foreground peer-hover/moon:bg-transparent"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Sun className="size-4 transition-all" />
      </div>
      <div
        className={cn(
          "peer/moon relative z-10 flex h-[30px] w-[30px] flex-row items-center justify-center transition-colors",
          theme === "light"
            ? "text-muted-foreground hover:text-foreground"
            : "text-foreground peer-hover/sun:text-muted-foreground bg-[#6F667A] peer-hover/sun:bg-transparent",
        )}
      >
        <Moon className="size-4 transition-all" />
      </div>
    </Button>
  );
}

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
          <ThemeSwitch />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
