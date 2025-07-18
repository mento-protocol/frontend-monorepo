import { getAllReserveData } from "@/app/lib/data-fetching";
import { MetricCards } from "@/app/components/metric-cards";
import { Navigation } from "@/app/components/navigation";
import { StablecoinSupplyContent } from "./components/stablecoin-supply-content";

export default async function StablecoinSupplyPage() {
  const { reserveStats, stableCoinStats } = await getAllReserveData();

  return (
    <>
      <section className="xl:px-22 max-w-2xl px-4 pt-0 md:px-20 md:pb-20">
        <MetricCards reserveStats={reserveStats} />
      </section>
      <section className="relative z-0 w-full px-4 md:px-20">
        <Navigation>
          <h2 className="relative z-10 my-6 hidden text-2xl font-medium md:mb-8 md:mt-12 md:block">
            Stablecoin Supply
          </h2>
          <div className="relative z-10">
            <StablecoinSupplyContent stableCoinStats={stableCoinStats} />
          </div>
        </Navigation>
      </section>
    </>
  );
}
