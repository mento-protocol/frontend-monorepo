"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button, cn } from "@repo/ui";

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();

  return (
    <>
      <div>
        <Button
          variant="switch"
          size="switch"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        >
          <div
            className={cn(
              "relative z-10 flex h-[28px] w-[28px] flex-row items-center justify-center",
              theme === "light"
                ? "bg-card text-foreground"
                : "text-muted-foreground",
            )}
          >
            <Sun className="transition-all" />
          </div>
          <div
            className={cn(
              "relative z-10 flex h-[28px] w-[28px] flex-row items-center justify-center",
              theme === "light"
                ? "text-muted-foreground"
                : "bg-card text-foreground",
            )}
          >
            <Moon className="transition-all" />
          </div>
        </Button>
      </div>
    </>
  );
}
