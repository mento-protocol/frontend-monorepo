import { getAllReserveData } from "../lib/data-fetching";
import { MetricCards } from "../components/metric-cards";
import { ReserveAddressesContent } from "./components/reserve-addresses-content";

export default async function ReserveAddressesPage() {
  // Fetch all data
  const { reserveStats, reserveAddresses } = await getAllReserveData();

  return (
    <>
      <section className="xl:px-22 max-w-2xl px-4 pt-0 md:px-20 md:pb-20">
        <MetricCards reserveStats={reserveStats} />
      </section>
      <section className="relative z-0 w-full px-4 md:px-20">
        <div className="mb-8 w-full">
          <div className="relative before:absolute before:left-1/2 before:top-0 before:z-0 before:h-20 before:w-screen before:-translate-x-1/2 before:bg-gradient-to-b before:from-[#15111B] before:to-[#070010]">
            <h2 className="relative z-10 my-6 hidden text-2xl font-medium md:mb-8 md:mt-12 md:block">
              Reserve Addresses
            </h2>
            <div className="relative z-10">
              <ReserveAddressesContent reserveAddresses={reserveAddresses} />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
