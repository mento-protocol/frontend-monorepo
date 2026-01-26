"use client";

import { ConnectButton } from "@repo/web3";

import { useTheme } from "next-themes";
import { useAtom } from "jotai";
import { Button, cn, Logo } from "@repo/ui";
import { Moon, Sun } from "lucide-react";
import { type AppTab, activeTabAtom } from "@/atoms/navigation";
import { useRef, useEffect, useState } from "react";

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
  const navRef = useRef<HTMLElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  // Update indicator position when active tab changes or window resizes
  useEffect(() => {
    const updateIndicatorPosition = () => {
      if (!navRef.current) return;

      const activeButton = navRef.current.querySelector(
        `[data-tab="${activeTab}"]`,
      ) as HTMLButtonElement;

      if (activeButton) {
        const navRect = navRef.current.getBoundingClientRect();
        const buttonRect = activeButton.getBoundingClientRect();

        setIndicatorStyle({
          left: buttonRect.left - navRect.left,
          width: buttonRect.width,
        });
      }
    };

    updateIndicatorPosition();

    window.addEventListener("resize", updateIndicatorPosition);
    return () => window.removeEventListener("resize", updateIndicatorPosition);
  }, [activeTab]);

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
        <div className="absolute left-1/2 -translate-x-1/2">
          <nav ref={navRef} className="gap-6 relative flex items-center">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                data-tab={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  "pb-1 text-md font-medium relative z-10 cursor-pointer transition-colors outline-none",
                  activeTab === tab.value
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
            {/* Sliding underline indicator */}
            <div
              className="bottom-0 h-0.5 ease-out absolute bg-primary transition-all duration-300"
              style={{
                left: `${indicatorStyle.left}px`,
                width: `${indicatorStyle.width}px`,
              }}
            />
          </nav>
        </div>
        <div className="gap-2 px-4 md:px-6 flex flex-row items-center justify-between">
          <ThemeSwitch />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
