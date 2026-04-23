"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui";
import type { V2MetaWarning } from "@/lib/types";

interface StalenessBannerProps {
  warnings: V2MetaWarning[];
}

function formatAge(cachedSinceIso: string): string | null {
  const cachedMs = Date.parse(cachedSinceIso);
  if (Number.isNaN(cachedMs)) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - cachedMs) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

function oldestAge(warnings: V2MetaWarning[]): string | null {
  const times = warnings
    .map((w) => (w.cached_since ? Date.parse(w.cached_since) : NaN))
    .filter((t) => !Number.isNaN(t));
  if (!times.length) return null;
  const oldest = Math.min(...times);
  return formatAge(new Date(oldest).toISOString());
}

export function StalenessBanner({ warnings }: StalenessBannerProps) {
  const [open, setOpen] = useState(false);

  if (!warnings.length) return null;

  const count = warnings.length;
  const age = oldestAge(warnings);
  const subject = count === 1 ? "1 data source is" : `${count} data sources are`;
  const summary = age
    ? `${subject} stale — some data is as old as ${age}`
    : `${subject} stale`;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-amber-500 border-l-4 bg-card"
    >
      <CollapsibleTrigger
        aria-label={open ? "Hide staleness details" : "Show staleness details"}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <span
          aria-hidden
          className="rounded bg-amber-500/20 px-1.5 py-0.5 font-medium text-amber-400 text-[10px] uppercase tracking-wide"
        >
          Stale
        </span>
        <span className="flex-1 text-sm">{summary}</span>
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
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 6l4 4 4-4"
          />
        </svg>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-3">
        <p className="text-muted-foreground text-xs">
          One or more data sources fell back to a cached snapshot. Values below
          may not reflect the latest state.
        </p>
        <ul className="mt-2 space-y-1.5">
          {warnings.map((warning, index) => (
            <li
              key={`${warning.source}-${index}`}
              className="text-muted-foreground text-xs"
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
