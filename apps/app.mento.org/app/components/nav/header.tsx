"use client";

import { BalancesSummary } from "@/components/nav/balances-summary";
import { ConnectButton } from "@/components/nav/connect-button";
import { Button, Logo } from "@repo/ui";
import {
  DollarSign,
  Droplets,
  LayoutGrid,
  ArrowUpDown,
  RefreshCw,
  Repeat,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { cn } from "@repo/ui";

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

const v3NavItems = [
  { href: "/v3/dashboard", icon: LayoutGrid, label: "Dashboard" },
  { href: "/v3/swap", icon: ArrowUpDown, label: "Swap" },
  { href: "/v3/trove", icon: DollarSign, label: "Troves" },
  { href: "/v3/redeem", icon: Repeat, label: "Redeem" },
  { href: "/v3/pools", icon: Droplets, label: "Pools" },
];

export function Header() {
  const pathname = usePathname();
  const isV3 = pathname.startsWith("/v3");

  return (
    <header className="bg-background/80 sticky top-0 z-50 border-b backdrop-blur-md">
      <div className="flex h-16 items-center justify-between px-0 md:px-0">
        <div className="flex items-center gap-8">
          <Logo />
          {isV3 ? (
            <div className="hidden items-center gap-6 md:flex">
              {v3NavItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 text-sm transition-colors hover:text-slate-900",
                    pathname === item.href
                      ? "font-medium text-slate-900"
                      : "text-slate-600",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-row items-center justify-between gap-2 px-4 md:px-6">
          <ThemeSwitch />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
