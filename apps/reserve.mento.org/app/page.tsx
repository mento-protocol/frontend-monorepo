import { getAnalyticsUrl } from "@/app/lib/config/endpoints";

interface ReserveStats {
  collateralization_ratio: number;
  total_reserve_value_usd: number;
  total_outstanding_stables_usd: number;
}

async function getReserveStats(): Promise<ReserveStats> {
  // For server-side rendering, we'll directly fetch from the external API
  // instead of going through our own API route
  const analyticsUrl = getAnalyticsUrl("reserveStats");
  if (!analyticsUrl) {
    throw new Error("Analytics API URL could not be constructed.");
  }

  const response = await fetch(analyticsUrl, {
    cache: "no-store", // Ensure fresh data on each request
  });

  if (!response.ok) {
    return {
      collateralization_ratio: 0,
      total_reserve_value_usd: 0,
      total_outstanding_stables_usd: 0,
    };
    // throw new Error(
    //   `Analytics API request failed with status ${response.status}`,
    // );
  }

  return response.json();
}

export default async function Home() {
  // const reserveStats = await getReserveStats();
  const reserveStats = {
    collateralization_ratio: 0,
    total_reserve_value_usd: 0,
    total_outstanding_stables_usd: 0,
  };
  const collateralizationRatio = reserveStats.collateralization_ratio;
  const totalSupply = reserveStats.total_outstanding_stables_usd;
  const reserveHoldings = reserveStats.total_reserve_value_usd;

  return (
    <main className="container p-20">
      <section className="max-w-md">
        <h1 className="text-5xl">Mento Reserve</h1>
        <p className="mt-2 text-gray-400">
          A diversified portfolio of crypto assets supporting the ability of the
          Mento Platform to expand and contract the supply of Mento stablecoins.
        </p>
        <div className="mt-16">
          <div className="flex items-center justify-between">
            <span>Collateralization ratio</span>
            <span>{collateralizationRatio.toFixed(2)}</span>
          </div>
          <hr className="my-2.5 border-gray-700" />
          <div className="flex items-center justify-between">
            <span>Total Supply</span>
            <span>${totalSupply.toLocaleString()}</span>
          </div>
          <hr className="my-2.5 border-gray-700" />
          <div className="flex items-center justify-between">
            <span>Reserve Holdings</span>
            <span>${reserveHoldings.toLocaleString()}</span>
          </div>
        </div>
      </section>
    </main>
  );
}
