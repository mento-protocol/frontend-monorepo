"use client";

import { useState } from "react";
import { Button, Card, TokenIcon, Toaster, IconCheck } from "@repo/ui";
import { Info, RefreshCw, Zap } from "lucide-react";
import { useV3Pools } from "@/features/v3/hooks/use-v3-pools";
import { useV3Rebalance } from "@/features/v3/hooks/use-v3-rebalance";
import { useAccount } from "wagmi";
import { USDm, EURm } from "@/lib/config/tokens";

export default function PoolsPage() {
  const { address } = useAccount();
  const { data: pools, isLoading, error, refetch } = useV3Pools();
  const rebalanceMutation = useV3Rebalance();
  const [expandedPool, setExpandedPool] = useState<string | null>(null);

  const handleRefreshPools = async () => {
    await refetch();
  };

  const handleRebalance = async (poolAddress: string) => {
    if (!address) {
      return;
    }

    try {
      await rebalanceMutation.mutateAsync(poolAddress);
    } catch (error: any) {
      // Error handling is done in the hook via toast
    }
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

  // Get token object for display
  const getTokenDisplay = (symbol: string) => {
    switch (symbol) {
      case "USD.m":
        return USDm;
      case "EUR.m":
        return EURm;
      default:
        return {
          id: symbol,
          symbol,
          name: symbol,
          color: "#000000",
          decimals: 18,
        };
    }
  };

  if (!address) {
    return (
      <div className="container mx-auto space-y-8 p-4 md:p-8">
        <div className="rounded-lg border-2 border-dashed py-12 text-center">
          <p className="text-slate-500">Connect your wallet to view pools.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto space-y-8 p-4 md:p-8">
        <div className="rounded-lg border-2 border-dashed py-12 text-center">
          <p className="text-red-500">
            Error loading pools. V3 might not be deployed on this network.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Toaster
        position="top-right"
        duration={5000}
        icons={{
          success: <IconCheck className="text-success" />,
        }}
        closeButton
        toastOptions={{
          classNames: {
            toast: "toast",
            title: "title",
            description: "description",
            actionButton: "action-button",
            cancelButton: "cancel-button",
            closeButton: "close-button",
            icon: "icon",
          },
        }}
        offset={{ top: "80px" }}
        mobileOffset={{ top: "96px" }}
      />
      <div className="container mx-auto space-y-8 p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold text-slate-900">Pools</h1>
          </div>
          <Button
            onClick={handleRefreshPools}
            disabled={isLoading}
            variant="outline"
            className="flex items-center gap-2 bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh Pools
          </Button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="rounded-lg border-2 border-dashed py-12 text-center">
            <p className="text-slate-500">Loading pools...</p>
          </div>
        )}

        {/* No Pools State */}
        {!isLoading && (!pools || pools.length === 0) && (
          <div className="rounded-lg border-2 border-dashed py-12 text-center">
            <p className="text-slate-500">No pools found.</p>
          </div>
        )}

        {/* Pools Table */}
        {!isLoading && pools && pools.length > 0 && (
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
                  {pools.map((pool) => (
                    <>
                      <tr key={pool.address} className="hover:bg-slate-50">
                        <td className="px-6 py-4 text-sm font-medium text-slate-900">
                          {pool.token0Symbol}/{pool.token1Symbol}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                              <TokenIcon
                                token={getTokenDisplay(pool.token0Symbol)}
                                size={16}
                              />
                              <span className="text-sm font-medium text-slate-900">
                                {pool.token0Symbol}
                              </span>
                            </div>
                            <span className="text-slate-600">/</span>
                            <div className="flex items-center gap-1">
                              <TokenIcon
                                token={getTokenDisplay(pool.token1Symbol)}
                                size={16}
                              />
                              <span className="text-sm font-medium text-slate-900">
                                {pool.token1Symbol}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-900">
                          ${parseFloat(pool.poolPrice).toFixed(4)}
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-900">
                          ${parseFloat(pool.oraclePrice).toFixed(4)}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {formatDeviation(pool.deviation)}
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-900">
                          {pool.rebalanceIncentive === "N/A"
                            ? "N/A"
                            : `${parseFloat(pool.rebalanceIncentive).toFixed(2)}%`}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-900">
                          {pool.lastRebalance}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-900">
                          {pool.rebalanceCooldown}
                        </td>
                        <td className="px-6 py-4">
                          <Button
                            onClick={() => togglePoolExpansion(pool.address)}
                            variant="outline"
                            size="sm"
                            className="text-sm transition-colors duration-200"
                          >
                            <span className="flex items-center gap-2">
                              {expandedPool === pool.address ? "Hide" : "View"}
                            </span>
                          </Button>
                        </td>
                      </tr>
                      {/* Always render the expanded row, but control its visibility */}
                      <tr key={`${pool.address}-expanded`}>
                        <td colSpan={9} className="overflow-hidden">
                          <div
                            className={`transition-all duration-300 ease-in-out ${
                              expandedPool === pool.address
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
                                        token={getTokenDisplay(
                                          pool.token0Symbol,
                                        )}
                                        size={16}
                                      />
                                      <span className="text-sm font-medium text-slate-900">
                                        {pool.token0Symbol} (
                                        {pool.reserves.token1.amount.toLocaleString()}
                                        )
                                      </span>
                                    </div>
                                    <span className="text-sm font-medium text-slate-900">
                                      $
                                      {pool.reserves.token1.value.toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="h-3 w-full rounded-full bg-slate-200">
                                    <div
                                      className="flex h-3 items-center justify-center rounded-full bg-blue-500 transition-all duration-300"
                                      style={{
                                        width: `${expandedPool === pool.address ? pool.reserves.token1.percentage : 0}%`,
                                      }}
                                    >
                                      <span className="text-xs font-medium text-white">
                                        {pool.reserves.token1.percentage.toFixed(
                                          1,
                                        )}
                                        %
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <TokenIcon
                                        token={getTokenDisplay(
                                          pool.token1Symbol,
                                        )}
                                        size={16}
                                      />
                                      <span className="text-sm font-medium text-slate-900">
                                        {pool.token1Symbol} (
                                        {pool.reserves.token2.amount.toLocaleString()}
                                        )
                                      </span>
                                    </div>
                                    <span className="text-sm font-medium text-slate-900">
                                      $
                                      {pool.reserves.token2.value.toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="h-3 w-full rounded-full bg-slate-200">
                                    <div
                                      className="flex h-3 items-center justify-center rounded-full bg-green-500 transition-all duration-300"
                                      style={{
                                        width: `${expandedPool === pool.address ? pool.reserves.token2.percentage : 0}%`,
                                      }}
                                    >
                                      <span className="text-xs font-medium text-white">
                                        {pool.reserves.token2.percentage.toFixed(
                                          1,
                                        )}
                                        %
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
                                      Pool Address:
                                    </span>
                                    <a
                                      href={`https://alfajores.celoscan.io/address/${pool.address}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="ml-2 font-mono text-sm text-slate-900 underline transition-colors hover:text-purple-600"
                                    >
                                      {pool.address.substring(0, 6)}...
                                      {pool.address.substring(38)}
                                    </a>
                                  </div>
                                  <div>
                                    <span className="text-sm font-medium text-slate-900">
                                      Tokens:
                                    </span>
                                    <span className="ml-2 text-sm text-slate-900">
                                      {pool.token0Symbol} / {pool.token1Symbol}
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
                                      {pool.rebalanceIncentive === "N/A"
                                        ? "N/A"
                                        : `${parseFloat(pool.rebalanceIncentive).toFixed(2)}%`}
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
                                    expandedPool === pool.address
                                      ? "translate-y-0 opacity-100"
                                      : "translate-y-4 opacity-0"
                                  }`}
                                >
                                  <Button
                                    onClick={() =>
                                      handleRebalance(pool.address)
                                    }
                                    disabled={
                                      !pool.canRebalance ||
                                      rebalanceMutation.isPending ||
                                      pool.rebalanceIncentive === "N/A"
                                    }
                                    className="mt-6 h-12 w-full bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                                  >
                                    <Zap className="mr-2 h-4 w-4" />
                                    {rebalanceMutation.isPending
                                      ? "Rebalancing..."
                                      : pool.rebalanceIncentive === "N/A"
                                        ? "Not in Liquidity Strategy"
                                        : pool.canRebalance
                                          ? "Rebalance Pool"
                                          : Math.abs(pool.deviation) <=
                                              Math.max(
                                                parseFloat(
                                                  pool.thresholdAbove === "N/A"
                                                    ? "0"
                                                    : pool.thresholdAbove,
                                                ),
                                                parseFloat(
                                                  pool.thresholdBelow === "N/A"
                                                    ? "0"
                                                    : pool.thresholdBelow,
                                                ),
                                              )
                                            ? "Within Thresholds"
                                            : "Cooldown Active"}
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
        )}

        {/* How Rebalancing Works */}
        <Card className="border-l-4 border-purple-500 bg-purple-50/80 p-6">
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
                  against the pool to correct this deviation. For example, if
                  USD.m is cheaper in the USD.m/EUR.m pool than the oracle
                  price, an arbitrageur can buy USD.m from the pool and sell it
                  elsewhere for a profit, pushing the pool price up towards the
                  oracle price.
                </p>
                <p>
                  The "Rebalance" button executes this arbitrage action through
                  the Liquidity Strategy contract. Each rebalancing action has a
                  cooldown period to prevent system abuse and ensure stability.
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
