import { getAllReserveData } from "./lib/data-fetching";
import { ReserveTabs } from "./components/reserve-tabs";
import { StalenessBanner } from "./components/staleness-banner";
import type { V2MetaWarning, ReservePageData } from "./lib/types";

function dedupeWarnings(data: ReservePageData): V2MetaWarning[] {
  const all = [
    ...(data.overview.meta?.warnings ?? []),
    ...(data.stablecoins.meta?.warnings ?? []),
    ...(data.reserve.meta?.warnings ?? []),
    ...(data.addresses.meta?.warnings ?? []),
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

function buildSummary(warnings: V2MetaWarning[]): string {
  const distinctSources = new Set(warnings.map((w) => w.source)).size;
  const subject =
    distinctSources === 1
      ? "1 data source is"
      : `${distinctSources} data sources are`;

  const cacheTimes = warnings
    .map((w) => (w.cached_since ? Date.parse(w.cached_since) : NaN))
    .filter((t) => !Number.isNaN(t));
  if (!cacheTimes.length) return `${subject} stale`;

  const age = formatAge(Math.min(...cacheTimes), Date.now());
  return `${subject} stale — some data is as old as ${age}`;
}

export default async function Home() {
  const data = await getAllReserveData();
  const warnings = dedupeWarnings(data);
  const summary = warnings.length ? buildSummary(warnings) : "";

  return (
    <section className="px-4 md:px-20 mt-8 md:mt-16 relative z-0 w-full">
      {warnings.length > 0 && (
        <div className="mb-6">
          <StalenessBanner warnings={warnings} summary={summary} />
        </div>
      )}
      <ReserveTabs data={data} />
    </section>
  );
}
