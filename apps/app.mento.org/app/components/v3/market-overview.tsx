"use client";

import { Card, TokenIcon } from "@repo/ui";
import { USDm } from "@/lib/config/tokens";
import { useV3Price } from "@/features/v3/hooks/use-v3-price";

export function MarketOverview() {
  const { data: priceData, isLoading, error } = useV3Price();

  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold text-slate-800">
        Market Overview
      </h2>
      <div className="grid grid-cols-4 gap-2 md:grid-cols-4">
        <Card className="relative rounded-lg bg-gray-900 p-4 text-white shadow-lg">
          <TokenIcon
            token={USDm}
            className="absolute right-4 top-4 h-8 w-8 opacity-90"
          />
          <h3 className="text-xl font-semibold">{USDm.symbol}</h3>
          <p className="text-xs text-gray-400">{USDm.name}</p>
          <div className="mt-0">
            <p className="text-xs text-gray-400">Oracle Price</p>
            <p className="font-mono text-xl">
              {isLoading ? (
                <span className="animate-pulse">Loading...</span>
              ) : error ? (
                <span className="text-red-400">Error</span>
              ) : (
                priceData?.priceFormatted || "$--"
              )}
            </p>
          </div>
        </Card>
      </div>
    </section>
  );
}
