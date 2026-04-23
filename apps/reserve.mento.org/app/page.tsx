import { getAllReserveData } from "./lib/data-fetching";
import { ReserveTabs } from "./components/reserve-tabs";
import { StalenessBanner } from "./components/staleness-banner";
import type { V2MetaWarning, ReservePageData } from "./lib/types";

function collectWarnings(data: ReservePageData): V2MetaWarning[] {
  const all = [
    ...(data.overview.meta?.warnings ?? []),
    ...(data.stablecoins.meta?.warnings ?? []),
    ...(data.reserve.meta?.warnings ?? []),
    ...(data.addresses.meta?.warnings ?? []),
  ];
  const seen = new Set<string>();
  return all.filter((warning) => {
    const key = `${warning.source}::${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function Home() {
  const data = await getAllReserveData();
  const warnings = collectWarnings(data);

  return (
    <section className="px-4 md:px-20 mt-8 md:mt-16 relative z-0 w-full">
      {warnings.length > 0 && (
        <div className="mb-6">
          <StalenessBanner warnings={warnings} />
        </div>
      )}
      <ReserveTabs data={data} />
    </section>
  );
}
