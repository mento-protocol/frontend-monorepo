"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@repo/ui";

interface TracerFrameProps {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}

export function TracerFrame({
  children,
  className,
  innerClassName,
}: TracerFrameProps) {
  const [tracerPosition, setTracerPosition] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTracerPosition((prev) => (prev + 1) % 100);
    }, 50);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div
        aria-hidden
        className={cn(
          "inset-0 pointer-events-none absolute overflow-hidden rounded-[inherit]",
          innerClassName,
        )}
        style={{
          background: `conic-gradient(from ${
            tracerPosition * 3.6
          }deg, transparent 0deg, transparent 328deg, oklch(0.5116 0.2893 289.05 / 0.96) 340deg, oklch(0.5116 0.2893 289.05 / 0.22) 350deg, transparent 360deg)`,
          padding: "1px",
        }}
      >
        <div className="h-full w-full rounded-[inherit]" />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
