import { Card, TokenIcon } from "@repo/ui";

const marketOverviewData = [
  { token: "CELO", price: "$1.45" },
  { token: "cUSD", price: "$1.01" },
  { token: "cEUR", price: "$1.06" },
  { token: "USDC", price: "$0.97" },
];

export function MarketOverview() {
  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold text-slate-800">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6"
        >
          <path d="M3 3v18h18" />
          <path d="m19 9-5 5-4-4-3 3" />
        </svg>
        Market Overview
      </h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {marketOverviewData.map((item) => (
          <Card
            key={item.token}
            className="flex items-center justify-between p-4"
          >
            <div className="flex items-center gap-3">
              <TokenIcon symbol={item.token as any} className="h-8 w-8" />
              <span className="font-semibold">{item.token}</span>
            </div>
            <span className="font-mono text-lg">{item.price}</span>
          </Card>
        ))}
      </div>
    </section>
  );
}
