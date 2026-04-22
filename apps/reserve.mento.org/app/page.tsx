import { getAllReserveData } from "./lib/data-fetching";
import { ReserveTabs } from "./components/reserve-tabs";

export default async function Home() {
  const data = await getAllReserveData();

  return (
    <section className="px-4 md:px-20 mt-8 md:mt-16 relative z-0 w-full">
      <ReserveTabs data={data} />
    </section>
  );
}
