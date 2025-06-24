import { TroveCard } from "./trove-card";

// Placeholder data until we have a real token data source.
const CELO = {
  id: "CELO",
  symbol: "CELO",
  name: "Celo",
  color: "#35D07F",
  decimals: 18,
};
const cUSD = {
  id: "cUSD",
  symbol: "cUSD",
  name: "Celo Dollar",
  color: "#47A14A",
  decimals: 18,
};
const cEUR = {
  id: "cEUR",
  symbol: "cEUR",
  name: "Celo Euro",
  color: "#68B4F1",
  decimals: 18,
};

const yourTrovesData = [
  {
    name: "Trove trove-1...",
    pair: { collateral: CELO, debt: cUSD },
    collateral: "1,000 CELO",
    debt: "750 cUSD",
    interestRate: "2.50%",
    liquidationPrice: "$0.7500",
    collateralizationRatio: "200.00%",
    collateralizationValue: 200,
  },
  {
    name: "Trove trove-2...",
    pair: { collateral: CELO, debt: cEUR },
    collateral: "500 CELO",
    debt: "300 cEUR",
    interestRate: "2.00%",
    liquidationPrice: "$0.6500",
    collateralizationRatio: "220.00%",
    collateralizationValue: 220,
  },
];

export function YourTroves() {
  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold text-slate-800">
        Your Troves
      </h2>
      {yourTrovesData.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
          {yourTrovesData.map((trove) => (
            <TroveCard key={trove.name} trove={trove} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed py-12 text-center">
          <p className="text-slate-500">You have no open Troves.</p>
        </div>
      )}
    </section>
  );
}
