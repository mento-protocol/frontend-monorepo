import { getAllReserveData } from "@/app/lib/data-fetching";
import { MetricCards } from "@/app/components/metric-cards";
import { Navigation } from "@/app/components/navigation";
import { ReserveHoldingsContent } from "./components/reserve-holdings-content";

export default async function ReserveHoldingsPage() {
  const { reserveStats, reserveComposition, reserveHoldings } =
    await getAllReserveData();

  return (
    <>
      <section className="xl:px-22 max-w-2xl px-4 pt-0 md:px-20 md:pb-20">
        <MetricCards reserveStats={reserveStats} />
      </section>
      <section className="relative z-0 w-full px-4 md:px-20">
        <Navigation>
          <div className="relative z-10">
            <ReserveHoldingsContent
              reserveComposition={reserveComposition}
              reserveHoldings={reserveHoldings}
            />
          </div>
        </Navigation>
      </section>
    </>
  );
}
