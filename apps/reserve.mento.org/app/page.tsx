import { getAllReserveData } from "./lib/data-fetching";
import { MetricCards } from "./components/metric-cards";
import { ReserveTabs } from "./components/reserve-tabs";

export default async function Home() {
  // Fetch all data once for both tabs
  const {
    reserveStats,
    stableCoinStats,
    reserveComposition,
    reserveHoldings,
    reserveAddresses,
  } = await getAllReserveData();

  return (
    <>
      <section className="xl:px-22 max-w-2xl px-4 pt-0 md:px-20 md:pb-20">
        <MetricCards reserveStats={reserveStats} />
      </section>
      <section className="px-4 md:px-20 relative z-0 w-full">
        <ReserveTabs
          stableCoinStats={stableCoinStats}
          reserveComposition={reserveComposition}
          reserveHoldings={reserveHoldings}
          reserveAddresses={reserveAddresses}
        />
      </section>
    </>
  );
}
