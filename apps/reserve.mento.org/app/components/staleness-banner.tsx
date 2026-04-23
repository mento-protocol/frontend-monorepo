"use client";

import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@repo/ui";
import { useV2Query } from "@/lib/use-v2-query";
import type { V2MetaWarning } from "@/lib/types";

function useAggregatedWarnings(): V2MetaWarning[] {
  const overview = useV2Query("overview").data;
  const stablecoins = useV2Query("stablecoins").data;
  const reserve = useV2Query("reserve").data;
  const addresses = useV2Query("addresses").data;

  const all = [
    ...(overview?.meta?.warnings ?? []),
    ...(stablecoins?.meta?.warnings ?? []),
    ...(reserve?.meta?.warnings ?? []),
    ...(addresses?.meta?.warnings ?? []),
  ];

  const byKey = new Map<string, V2MetaWarning>();
  for (const warning of all) {
    const key = `${warning.source}::${warning.message}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, warning);
      continue;
    }
    const existingMs = existing.cached_since
      ? Date.parse(existing.cached_since)
      : Number.POSITIVE_INFINITY;
    const candidateMs = warning.cached_since
      ? Date.parse(warning.cached_since)
      : Number.POSITIVE_INFINITY;
    if (candidateMs < existingMs) byKey.set(key, warning);
  }
  return Array.from(byKey.values());
}

function formatAge(cachedSinceMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - cachedSinceMs) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

function buildSummary(warnings: V2MetaWarning[], nowMs: number | null): string {
  const distinctSources = new Set(warnings.map((w) => w.source)).size;
  const subject =
    distinctSources === 1
      ? "1 data source is"
      : `${distinctSources} data sources are`;

  if (nowMs === null) return `${subject} stale`;

  const cacheTimes = warnings
    .map((w) => (w.cached_since ? Date.parse(w.cached_since) : NaN))
    .filter((t) => !Number.isNaN(t));
  if (!cacheTimes.length) return `${subject} stale`;
  const age = formatAge(Math.min(...cacheTimes), nowMs);
  return `${subject} stale — some data is as old as ${age}`;
}

export function StalenessBanner() {
  const [open, setOpen] = useState(false);
  // Defer time-based rendering until after mount so server and first
  // client render produce identical markup.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => setNowMs(Date.now()), []);

  const warnings = useAggregatedWarnings();
  if (!warnings.length) return null;

  const summary = buildSummary(warnings, nowMs);

  return (
    <div className="mb-6">
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="border-amber-500 border-l-4 bg-card"
      >
        <CollapsibleTrigger
          aria-label={
            open ? "Hide staleness details" : "Show staleness details"
          }
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
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 6l4 4 4-4"
            />
          </svg>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-3">
          <p className="text-xs text-muted-foreground">
            One or more data sources fell back to a cached snapshot. Values
            below may not reflect the latest state.
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
    </div>
  );
}
