"use client";

import Link from "next/link";
import { ConnectButton } from "@/components/nav/connect-button";

import { useTheme } from "next-themes";
import { Button, cn, Logo } from "@repo/ui";
import { Moon, Sun } from "lucide-react";

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="switch"
      size="switch"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
    >
      <div
        className={cn(
          "relative z-10 flex h-[30px] w-[30px] flex-row items-center justify-center",
          theme === "light"
            ? "bg-card text-foreground"
            : "text-muted-foreground",
        )}
      >
        <Sun className="size-4 transition-all" />
      </div>
      <div
        className={cn(
          "relative z-10 flex h-[30px] w-[30px] flex-row items-center justify-center",
          theme === "light"
            ? "text-muted-foreground"
            : "text-foreground bg-[#6F667A]",
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
        <Link href="/" className="flex items-center">
          <Logo />
        </Link>
        <div className="flex flex-row items-center justify-between gap-2 px-4 md:px-6">
          <ThemeSwitch />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
