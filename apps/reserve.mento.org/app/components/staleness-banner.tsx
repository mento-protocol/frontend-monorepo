"use client";

import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@repo/ui";
import type { V2MetaWarning } from "@/lib/types";

interface StalenessBannerProps {
  warnings: V2MetaWarning[];
  summary: string;
}

export function StalenessBanner({ warnings, summary }: StalenessBannerProps) {
  const [open, setOpen] = useState(false);

  if (!warnings.length) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-amber-500 border-l-4 bg-card"
    >
      <CollapsibleTrigger
        aria-label={open ? "Hide staleness details" : "Show staleness details"}
        className="gap-3 px-4 py-2.5 flex w-full items-center text-left"
      >
        <span
          aria-hidden
          className="rounded bg-amber-500/20 px-1.5 py-0.5 font-medium text-amber-400 tracking-wide text-[10px] uppercase"
        >
          Stale
        </span>
        <span className="text-sm flex-1">{summary}</span>
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6l4 4 4-4" />
        </svg>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-3">
        <p className="text-xs text-muted-foreground">
          One or more data sources fell back to a cached snapshot. Values below
          may not reflect the latest state.
        </p>
        <ul className="mt-2 space-y-1.5">
          {warnings.map((warning, index) => (
            <li
              key={`${warning.source}-${index}`}
              className="text-xs text-muted-foreground"
            >
              <span className="text-foreground">{warning.source}:</span>{" "}
              {warning.message}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
