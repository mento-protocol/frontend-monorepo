"use client";

import { ConnectButton } from "@repo/web3";

import { useTheme } from "next-themes";
import { useAtom } from "jotai";
import { Button, cn, Logo } from "@repo/ui";
import { Moon, Sun } from "lucide-react";
import { type AppTab, activeTabAtom } from "@/atoms/navigation";

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
            ? "bg-card text-foreground peer-hover/moon:bg-transparent peer-hover/moon:text-muted-foreground"
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
            : "bg-[#6F667A] text-foreground peer-hover/sun:bg-transparent peer-hover/sun:text-muted-foreground",
        )}
      >
        <Moon className="size-4 transition-all" />
      </div>
    </Button>
  );
}

const tabs: { value: AppTab; label: string }[] = [
  { value: "swap", label: "Swap" },
  { value: "pool", label: "Pool" },
  { value: "borrow", label: "Borrow" },
];

export function Header() {
  const [activeTab, setActiveTab] = useAtom(activeTabAtom);

  return (
    <header className="relative z-10">
      <div className="h-20 gap-6 flex flex-row items-center justify-between">
        <a
          href="https://www.mento.org"
          className="flex items-center"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Mento.org"
        >
          <Logo />
        </a>
        <nav className="gap-6 absolute left-1/2 flex -translate-x-1/2 items-center">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                "pb-1 text-md font-medium cursor-pointer border-0 border-b-2 transition-colors outline-none",
                activeTab === tab.value
                  ? "border-b-primary text-foreground"
                  : "border-b-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="gap-2 px-4 md:px-6 flex flex-row items-center justify-between">
          <ThemeSwitch />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
