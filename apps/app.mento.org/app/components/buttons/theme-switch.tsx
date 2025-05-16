"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@repo/ui";

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();

  return (
    <>
      <div>
        <Button
          className={`gap-0 after:absolute after:top-[2px] after:z-0 after:h-[30px] after:w-[30px] after:transition-all after:duration-300 ${theme === "light" ? "after:left-[2px] after:bg-white" : "after:left-[34px] after:bg-[#6F667A]"}`}
          variant="switch"
          size="switch"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        >
          <div className="relative z-10 flex h-8 w-8 flex-row items-center justify-center">
            <Sun
              className="transition-all"
              color={` ${theme === "light" ? "#6F667A" : "#6F667A"} `}
            />
          </div>
          <div className="relative z-10 flex h-8 w-8 flex-row items-center justify-center">
            <Moon
              className="transition-all"
              color={` ${theme === "light" ? "#6F667A" : "#ffffff"}`}
            />
          </div>
          {/* <div
            className={`absolute h-[30px] w-[30px] bg-[#6F667A] ${theme === "light" ? "left-[1px]" : "left-8"}`}
          ></div> */}
        </Button>
      </div>
    </>
  );
}
