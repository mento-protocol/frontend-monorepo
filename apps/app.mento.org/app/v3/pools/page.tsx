"use client";

import { useState } from "react";
import { Button, Card, TokenIcon } from "@repo/ui";
import { Info, RefreshCw, Zap } from "lucide-react";
import { CELO, cUSD, cEUR } from "@/lib/config/tokens";

interface PoolData {
  id: string;
  name: string;
  tokens: { token: typeof CELO; symbol: string }[];
  poolPrice: string;
  oraclePrice: string;
  deviation: number;
  incentive: number;
  lastRebalance: string;
  cooldown: string;
  canRebalance: boolean;
  reserves: {
    token1: { amount: number; value: number; percentage: number };
    token2: { amount: number; value: number; percentage: number };
    total: number;
  };
  details: {
    currentPoolPrice: string;
    oracleTargetPrice: string;
    thresholds: string;
  };
}

const poolsData: PoolData[] = [
  {
    id: "cusd-ceur",
    name: "cUSD/cEUR Pool",
    tokens: [
      { token: cUSD, symbol: "cUSD" },
      { token: cEUR, symbol: "cEUR" },
    ],
    poolPrice: "0.9273 cEUR",
    oraclePrice: "0.9260 cEUR",
    deviation: 0.14,
    incentive: 0.5,
    lastRebalance: "2025-06-23 10:00 AM",
    cooldown: "2025-06-24 10:00 AM",
    canRebalance: true,
    reserves: {
      token1: { amount: 100000, value: 98550.0, percentage: 49.7 },
      token2: { amount: 92500, value: 99807.5, percentage: 50.3 },
      total: 198357.5,
    },
    details: {
      currentPoolPrice: "0.9273 cEUR per cUSD",
      oracleTargetPrice: "0.9260 cEUR per cUSD",
      thresholds: "+1.00% / -1.00%",
    },
  },
  {
    id: "celo-cusd",
    name: "CELO/cUSD Pool",
    tokens: [
      { token: CELO, symbol: "CELO" },
      { token: cUSD, symbol: "cUSD" },
    ],
    poolPrice: "1.4856 cUSD",
    oraclePrice: "1.5000 cUSD",
    deviation: -0.96,
    incentive: 0.3,
    lastRebalance: "2025-06-22 02:00 PM",
    cooldown: "2025-06-23 02:00 PM",
    canRebalance: false,
    reserves: {
      token1: { amount: 75000, value: 111420.0, percentage: 52.1 },
      token2: { amount: 102500, value: 102500.0, percentage: 47.9 },
      total: 213920.0,
    },
    details: {
      currentPoolPrice: "1.4856 cUSD per CELO",
      oracleTargetPrice: "1.5000 cUSD per CELO",
      thresholds: "+2.00% / -2.00%",
    },
  },
];

export default function PoolsPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedPool, setExpandedPool] = useState<string | null>(null);

  const handleRefreshPools = async () => {
    setIsRefreshing(true);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setIsRefreshing(false);
  };

  const handleRebalance = (poolId: string) => {
    alert(`Rebalancing ${poolId} pool (This is a demo)`);
  };

  const togglePoolExpansion = (poolId: string) => {
    setExpandedPool(expandedPool === poolId ? null : poolId);
  };

  const formatDeviation = (deviation: number) => {
    const color = deviation > 0 ? "text-green-600" : "text-red-600";
    const sign = deviation > 0 ? "+" : "";
    return (
      <span className={color}>
        {sign}
        {deviation.toFixed(2)}%
      </span>
    );
  };

  return (
    <div className="container mx-auto space-y-8 p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="mb-2 text-3xl font-bold text-slate-900">Pools</h1>
        </div>
        <Button
          onClick={handleRefreshPools}
          disabled={isRefreshing}
          variant="outline"
          className="flex items-center gap-2 bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
        >
          <RefreshCw
            className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh Pools
        </Button>
      </div>

      {/* Pools Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-100 dark:bg-slate-800">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-900 dark:text-slate-300">
                  Pool
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-900 dark:text-slate-300">
                  Tokens
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-900 dark:text-slate-300">
                  Pool Price
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-900 dark:text-slate-300">
                  Oracle Price
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-900 dark:text-slate-300">
                  Deviation
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-900 dark:text-slate-300">
                  Incentive
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-900 dark:text-slate-300">
                  Last Rebalance
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-900 dark:text-slate-300">
                  Cooldown
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-900 dark:text-slate-300">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {poolsData.map((pool) => (
                <>
                  <tr key={pool.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">
                      {pool.name}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {pool.tokens.map((tokenInfo, index) => (
                          <div
                            key={tokenInfo.symbol}
                            className="flex items-center gap-1"
                          >
                            <TokenIcon token={tokenInfo.token} size={16} />
                            <span className="text-sm font-medium text-slate-900">
                              {tokenInfo.symbol}
                            </span>
                            {index < pool.tokens.length - 1 && (
                              <span className="text-slate-600">/</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">
                      {pool.poolPrice}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">
                      {pool.oraclePrice}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {formatDeviation(pool.deviation)}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">
                      {pool.incentive.toFixed(2)}%
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-900">
                      {pool.lastRebalance}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-900">
                      {pool.cooldown}
                    </td>
                    <td className="px-6 py-4">
                      <Button
                        onClick={() => togglePoolExpansion(pool.id)}
                        variant="outline"
                        size="sm"
                        className="text-sm transition-colors duration-200"
                      >
                        <span className="flex items-center gap-2">
                          {expandedPool === pool.id ? "Hide" : "View"}
                        </span>
                      </Button>
                    </td>
                  </tr>
                  {/* Always render the expanded row, but control its visibility */}
                  <tr key={`${pool.id}-expanded`}>
                    <td colSpan={9} className="overflow-hidden">
                      <div
                        className={`transition-all duration-300 ease-in-out ${
                          expandedPool === pool.id
                            ? "max-h-[800px] py-6 opacity-100"
                            : "max-h-0 py-0 opacity-0"
                        } bg-slate-50 px-6`}
                      >
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                          {/* Pool Reserves Breakdown */}
                          <div>
                            <h4 className="mb-4 text-lg font-semibold text-slate-900">
                              Pool Reserves Breakdown
                            </h4>
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <TokenIcon
                                    token={pool.tokens[0].token}
                                    size={16}
                                  />
                                  <span className="text-sm font-medium text-slate-900">
                                    {pool.tokens[0].symbol} (
                                    {pool.reserves.token1.amount.toLocaleString()}
                                    )
                                  </span>
                                </div>
                                <span className="text-sm font-medium text-slate-900">
                                  ${pool.reserves.token1.value.toLocaleString()}
                                </span>
                              </div>
                              <div className="h-3 w-full rounded-full bg-slate-200">
                                <div
                                  className="flex h-3 items-center justify-center rounded-full bg-blue-500 transition-all duration-300"
                                  style={{
                                    width: `${expandedPool === pool.id ? pool.reserves.token1.percentage : 0}%`,
                                  }}
                                >
                                  <span className="text-xs font-medium text-white">
                                    {pool.reserves.token1.percentage}%
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <TokenIcon
                                    token={pool.tokens[1].token}
                                    size={16}
                                  />
                                  <span className="text-sm font-medium text-slate-900">
                                    {pool.tokens[1].symbol} (
                                    {pool.reserves.token2.amount.toLocaleString()}
                                    )
                                  </span>
                                </div>
                                <span className="text-sm font-medium text-slate-900">
                                  ${pool.reserves.token2.value.toLocaleString()}
                                </span>
                              </div>
                              <div className="h-3 w-full rounded-full bg-slate-200">
                                <div
                                  className="flex h-3 items-center justify-center rounded-full bg-green-500 transition-all duration-300"
                                  style={{
                                    width: `${expandedPool === pool.id ? pool.reserves.token2.percentage : 0}%`,
                                  }}
                                >
                                  <span className="text-xs font-medium text-white">
                                    {pool.reserves.token2.percentage}%
                                  </span>
                                </div>
                              </div>

                              <div className="border-t border-slate-200 pt-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-semibold text-slate-900">
                                    Total Pool Value
                                  </span>
                                  <span className="text-sm font-semibold text-slate-900">
                                    ${pool.reserves.total.toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Pool Details */}
                          <div>
                            <h4 className="mb-4 text-lg font-semibold text-slate-900">
                              Pool Details
                            </h4>
                            <div className="space-y-3">
                              <div>
                                <span className="text-sm font-medium text-slate-900">
                                  Pool Name:
                                </span>
                                <span className="ml-2 text-sm text-slate-900">
                                  {pool.name}
                                </span>
                              </div>
                              <div>
                                <span className="text-sm font-medium text-slate-900">
                                  Tokens:
                                </span>
                                <span className="ml-2 text-sm text-slate-900">
                                  {pool.tokens.map((t) => t.symbol).join(" / ")}
                                </span>
                              </div>
                              <div>
                                <span className="text-sm font-medium text-slate-900">
                                  Current Pool Price:
                                </span>
                                <span className="ml-2 text-sm text-slate-900">
                                  {pool.details.currentPoolPrice}
                                </span>
                              </div>
                              <div>
                                <span className="text-sm font-medium text-slate-900">
                                  Oracle Target Price:
                                </span>
                                <span className="ml-2 text-sm text-slate-900">
                                  {pool.details.oracleTargetPrice}
                                </span>
                              </div>
                              <div>
                                <span className="text-sm font-medium text-slate-900">
                                  Deviation from Oracle:
                                </span>
                                <span className="ml-2 text-sm">
                                  {formatDeviation(pool.deviation)}
                                </span>
                              </div>
                              <div>
                                <span className="text-sm font-medium text-slate-900">
                                  Rebalance Incentive:
                                </span>
                                <span className="ml-2 text-sm text-slate-900">
                                  {pool.incentive.toFixed(2)}%
                                </span>
                              </div>
                              <div>
                                <span className="text-sm font-medium text-slate-900">
                                  Thresholds for Rebalance:
                                </span>
                                <span className="ml-2 text-sm text-slate-900">
                                  {pool.details.thresholds}
                                </span>
                              </div>
                            </div>

                            <div
                              className={`transition-all duration-300 ${
                                expandedPool === pool.id
                                  ? "translate-y-0 opacity-100"
                                  : "translate-y-4 opacity-0"
                              }`}
                            >
                              <Button
                                onClick={() => handleRebalance(pool.id)}
                                disabled={!pool.canRebalance}
                                className="mt-6 h-12 w-full bg-purple-600 text-white hover:bg-purple-700"
                              >
                                <Zap className="mr-2 h-4 w-4" />
                                Rebalance Pool
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* How Rebalancing Works */}
      <Card className="border-l-4 border-purple-500 bg-purple-50 p-6">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-purple-500" />
          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-900">
              How Rebalancing Works
            </h3>
            <div className="space-y-2 text-sm text-slate-700">
              <p>
                Pool rebalancing is crucial for maintaining the stability of
                Mento's assets. When a liquidity pool's internal price (Pool
                Price) deviates too far from the real-world price (Oracle
                Price), it creates an imbalance.
              </p>
              <p>
                Arbitrageurs are incentivized (Rebalance Incentive) to trade
                against the pool to correct this deviation. For example, if CELO
                is cheaper in the CELO/cUSD pool than on external exchanges, an
                arbitrageur can buy CELO from the pool and sell it elsewhere for
                a profit, pushing the pool price up towards the oracle price.
              </p>
              <p>
                The "Rebalance" button simulates this arbitrage action. Each
                rebalancing action has a cooldown period to prevent system abuse
                and ensure stability.
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
