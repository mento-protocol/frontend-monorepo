import { Card, TokenIcon } from "@repo/ui";

const marketOverviewData = [
  {
    id: "USD.m",
    symbol: "USD.m",
    name: "Mento Dollar",
    color: "#000000",
    decimals: 18,
    price: "$1.01",
  },
];

interface Token {
  id: string;
  symbol: string;
  name: string;
  color: string;
  decimals: number;
}

export function MarketOverview() {
  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold text-slate-800">
        Market Overview
      </h2>
      <div className="grid grid-cols-4 gap-2 md:grid-cols-4">
        {marketOverviewData.map((item) => (
          <Card
            key={item.id}
            className="relative rounded-lg bg-gray-900 p-4 text-white shadow-lg"
          >
            <TokenIcon
              token={item as Token}
              className="absolute right-4 top-4 h-8 w-8 opacity-90"
            />
            <h3 className="text-xl font-semibold">{item.symbol}</h3>
            <p className="text-xs text-gray-400">{item.name}</p>
            <div className="mt-0">
              <p className="text-xs text-gray-400">Price</p>
              <p className="font-mono text-xl">{item.price}</p>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
