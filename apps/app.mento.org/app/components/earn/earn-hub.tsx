"use client";

import { useState, useMemo } from "react";
import { useAtomValue } from "jotai";
import { getStabilityRoute } from "@/lib/stability-route";
import { Card, CardContent, cn } from "@repo/ui";
import {
  selectedDebtTokenAtom,
  useStabilityPool,
  useStabilityPoolApy,
  useStabilityPoolStats,
  useAllPoolsList,
  usePoolRewards,
  getPoolRewardKey,
  chainIdToSlug,
  chainIdToChain,
  ChainId,
  VISIBLE_CHAINS,
  type PoolDisplay,
  type PoolRewardInfo,
  type ChainFilterType,
} from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { RewardsCampaignBanner } from "../pools/rewards-campaign-banner";
import {
  OpportunityCard,
  type Opportunity,
  type StabilityOpportunity,
  type LpOpportunity,
} from "./opportunity-card";
import Image from "next/image";
import { Clock, Plus, TrendingUp, Info, ExternalLink } from "lucide-react";
import { formatUnits } from "viem";

type EarnFilter = "all" | "stability" | "lp" | "rewards";

function formatCompactUsd(value: number | null): string {
  if (value == null) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatCompactToken(
  amount: bigint | null | undefined,
  symbol: string,
): string {
  if (amount == null) return `0 ${symbol}`;
  const num = Number(formatUnits(amount, 18));
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M ${symbol}`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K ${symbol}`;
  if (num === 0) return `0 ${symbol}`;
  return `${num.toFixed(2)} ${symbol}`;
}

export function EarnHub() {
  const [filter, setFilter] = useState<EarnFilter>("all");
  const [chainFilter, setChainFilter] = useState<ChainFilterType>("all");

  const { isConnected } = useAccount();
  const debtToken = useAtomValue(selectedDebtTokenAtom);

  // Always fetch stability pool data from Celo (where borrow/SP is deployed)
  const spChainId = ChainId.Celo;

  // Stability Pool data — always from Celo regardless of connected chain
  const { data: spPosition } = useStabilityPool(debtToken.symbol, spChainId);
  const { data: totalDeposits } = useStabilityPoolStats(
    debtToken.symbol,
    spChainId,
  );
  const { data: spApy, avgInterestRate } = useStabilityPoolApy(
    debtToken.symbol,
    spChainId,
  );

  // LP Pool data — fetches across all chains
  const { data: pools = [] } = useAllPoolsList();
  const { rewards } = usePoolRewards();

  // Resolve token addresses on Celo for stability pool icons
  const debtTokenAddress = (() => {
    try {
      return getTokenAddress(
        spChainId,
        debtToken.symbol as TokenSymbol,
      ) as `0x${string}`;
    } catch {
      return undefined;
    }
  })();

  // Build stability pool opportunity (always Celo)
  const stabilityOpportunity: StabilityOpportunity | null = useMemo(() => {
    const hasDeposit = (spPosition?.deposit ?? 0n) > 0n;
    const hasRewards =
      (spPosition?.debtTokenGain ?? 0n) > 0n ||
      (spPosition?.collateralGain ?? 0n) > 0n;

    const apyValue = spApy != null ? spApy * 100 : 0;
    const avgRate = avgInterestRate != null ? avgInterestRate * 100 : 0;
    const totalDep = formatCompactToken(
      totalDeposits ?? null,
      debtToken.symbol,
    );

    let userPosition = null;
    if (isConnected && hasDeposit) {
      const deposited = formatCompactToken(
        spPosition?.deposit ?? 0n,
        debtToken.symbol,
      );
      const rewardParts: string[] = [];
      if (spPosition?.debtTokenGain && spPosition.debtTokenGain > 0n) {
        rewardParts.push(
          formatCompactToken(spPosition.debtTokenGain, debtToken.symbol),
        );
      }
      if (spPosition?.collateralGain && spPosition.collateralGain > 0n) {
        rewardParts.push(formatCompactToken(spPosition.collateralGain, "USDm"));
      }
      userPosition = {
        deposited,
        rewards: rewardParts.length > 0 ? rewardParts.join(" + ") : undefined,
      };
    }

    return {
      id: `sp-${spChainId}-${debtToken.symbol.toLowerCase()}`,
      type: "stability" as const,
      chainId: spChainId,
      name: `${debtToken.symbol} Stability Pool`,
      token: {
        address: debtTokenAddress ?? "",
        symbol: debtToken.symbol,
      },
      apy: apyValue,
      apyLabel: "Pool APY",
      hasRewards: false,
      earnMechanics: [
        { label: "Liquidation gains", color: "green" as const },
        { label: "Protocol yield", color: "indigo" as const },
        {
          label: "Trove interest",
          color: "amber" as const,
          value: avgRate > 0 ? `${avgRate.toFixed(1)}%` : undefined,
        },
      ],
      stats: [
        { label: "Total deposits", value: totalDep },
        {
          label: "Avg. borrow rate",
          value: avgRate > 0 ? `${avgRate.toFixed(1)}%` : "—",
        },
        { label: "Lock-up", value: "None" },
      ],
      userPosition,
      href: getStabilityRoute(debtToken.symbol),
    };
  }, [
    spChainId,
    spPosition,
    spApy,
    avgInterestRate,
    totalDeposits,
    debtToken,
    debtTokenAddress,
    isConnected,
  ]);

  // Build LP pool opportunities
  const lpOpportunities: LpOpportunity[] = useMemo(() => {
    // Only show FPMM pools (Legacy pools don't support liquidity actions)
    const fpmmPools = pools.filter((p) => p.poolType === "FPMM");

    return fpmmPools.map((pool) => {
      const rewardKey = getPoolRewardKey(pool.chainId, pool.poolAddr);
      const reward = rewards.get(rewardKey);
      const hasReward = !!reward;

      const feePercent = pool.fees.total;
      const rewardApr = reward?.apr ?? 0;
      const totalApr = feePercent + rewardApr;

      const mechanics: LpOpportunity["earnMechanics"] = [
        {
          label: "Swap fees",
          color: "indigo",
          value: `${feePercent.toFixed(2)}%`,
        },
      ];
      if (hasReward) {
        mechanics.push({
          label: "MENTO rewards",
          color: "green",
          value: `+${rewardApr.toFixed(1)}%`,
        });
      }

      const tvlDisplay = pool.tvl != null ? formatCompactUsd(pool.tvl) : "—";
      const slug = chainIdToSlug(pool.chainId);

      return {
        id: `lp-${pool.chainId}-${pool.poolAddr.toLowerCase()}`,
        type: "lp" as const,
        chainId: pool.chainId,
        name: `${pool.token0.symbol} / ${pool.token1.symbol}`,
        tokenA: {
          address: pool.token0.address,
          symbol: pool.token0.symbol,
        },
        tokenB: {
          address: pool.token1.address,
          symbol: pool.token1.symbol,
        },
        apy: totalApr,
        apyLabel: "Total APR",
        hasRewards: hasReward,
        earnMechanics: mechanics,
        stats: [
          { label: "TVL", value: tvlDisplay },
          { label: "Pool fee", value: `${feePercent.toFixed(2)}%` },
          { label: "Lock-up", value: "None" },
        ],
        userPosition: null, // LP user positions require per-pool balance lookups; shown on pool detail page
        href: `/pools/${slug}/${pool.poolAddr}`,
      };
    });
  }, [pools, rewards]);

  // Combine and filter/sort
  const allOpportunities: Opportunity[] = useMemo(() => {
    const all: Opportunity[] = [];
    if (stabilityOpportunity) all.push(stabilityOpportunity);
    all.push(...lpOpportunities);
    return all;
  }, [stabilityOpportunity, lpOpportunities]);

  const filtered = useMemo(() => {
    let result = allOpportunities;

    if (filter === "stability")
      result = result.filter((o) => o.type === "stability");
    if (filter === "lp") result = result.filter((o) => o.type === "lp");
    if (filter === "rewards") result = result.filter((o) => o.hasRewards);

    if (chainFilter !== "all") {
      result = result.filter((o) => o.chainId === chainFilter);
    }

    // Always sort by highest APY
    result = [...result].sort((a, b) => b.apy - a.apy);

    return result;
  }, [allOpportunities, filter, chainFilter]);

  const filterOptions: { key: EarnFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "stability", label: "Stability Pool" },
    { key: "lp", label: "Liquidity Pools" },
    { key: "rewards", label: "\u2605 With Rewards" },
  ];

  const steps = [
    {
      icon: <Clock className="h-5 w-5" />,
      title: "Compare options",
      desc: "Each card shows APY and how you earn. Compare Stability Pool vs LP pools side by side.",
    },
    {
      icon: <Plus className="h-5 w-5" />,
      title: "Deposit & earn",
      desc: "Click any opportunity to go to its deposit page. No lock-up on any option, withdraw anytime.",
    },
    {
      icon: <TrendingUp className="h-5 w-5" />,
      title: "Claim rewards",
      desc: "Earnings accumulate automatically. Claim or compound whenever you want from each position\u2019s page.",
    },
  ];

  return (
    <div className="max-w-5xl space-y-6 px-4 pt-6 md:px-0 md:pt-0 pb-16 relative w-full">
      {/* Header */}
      <div className="relative">
        <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card" />
        <div className="p-6 bg-card">
          <span className="font-mono font-medium tracking-widest text-[11px] text-muted-foreground uppercase">
            Yield opportunities
          </span>
          <h1 className="mt-2 font-bold text-3xl">Earn</h1>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            Earn yield through stability pool deposits and liquidity provision.
            Compare rates and opportunities in one place.
          </p>
        </div>
      </div>

      {/* Portfolio Summary — hidden until subgraph is available for accurate cross-position aggregation */}

      {/* Rewards Campaign Banner */}
      {rewards.size > 0 && (
        <RewardsCampaignBanner rewards={rewards} pools={pools} />
      )}

      {/* Filters + Sort */}
      <div className="gap-3 md:flex-row md:items-center md:justify-between flex flex-col flex-wrap">
        <div className="gap-1 flex flex-wrap items-center">
          {filterOptions.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "px-3.5 py-1.5 text-xs font-semibold cursor-pointer rounded-lg border-0 transition-colors outline-none",
                filter === f.key
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}

          {/* Chain filter divider + buttons */}
          <div className="mx-1 h-5 md:block hidden w-px bg-border" />
          <button
            type="button"
            onClick={() => setChainFilter("all")}
            className={cn(
              "px-3.5 py-1.5 text-xs font-semibold cursor-pointer rounded-lg border-0 transition-colors outline-none",
              chainFilter === "all"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            All
          </button>
          {VISIBLE_CHAINS.map((id) => {
            const chain = chainIdToChain[id];
            const iconUrl = (chain as unknown as Record<string, unknown>)
              ?.iconUrl as string | undefined;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setChainFilter(id)}
                className={cn(
                  "gap-1.5 px-3.5 py-1.5 text-xs font-semibold inline-flex cursor-pointer items-center rounded-lg border-0 transition-colors outline-none",
                  chainFilter === id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {iconUrl && (
                  <Image
                    src={iconUrl}
                    alt={chain?.name ?? ""}
                    width={16}
                    height={16}
                    className="h-4 w-4 rounded-full"
                    unoptimized
                  />
                )}
                {chain?.name ?? `Chain ${id}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Opportunity Grid */}
      <div className="gap-4 md:grid-cols-2 grid grid-cols-1">
        {filtered.map((opp) => (
          <OpportunityCard key={opp.id} opp={opp} />
        ))}
        {filtered.length === 0 && (
          <div className="py-12 text-sm col-span-full text-center text-muted-foreground">
            No opportunities match the current filter.
          </div>
        )}
      </div>

      {/* How Earning Works */}
      <div>
        <h3 className="mb-4 font-mono font-semibold tracking-widest text-[11px] text-muted-foreground uppercase">
          How earning works
        </h3>
        <div className="gap-4 md:grid-cols-3 grid grid-cols-1">
          {steps.map((step, i) => (
            <Card
              key={i}
              className="!py-0 !gap-0 transition-colors hover:bg-accent/50"
            >
              <CardContent className="p-6">
                <div className="mb-3.5 gap-3 flex items-center">
                  <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {step.icon}
                  </div>
                  <span className="font-mono font-semibold text-[11px] text-muted-foreground/25">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h4 className="mb-1.5 font-semibold text-[15px]">
                  {step.title}
                </h4>
                <p className="leading-relaxed text-[13px] text-muted-foreground/60">
                  {step.desc}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Risk Disclosure */}
      <div className="gap-3 px-5 py-4 flex items-start rounded-xl border border-border/50 bg-accent/20">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
        <div className="text-xs leading-relaxed text-muted-foreground/60">
          <span className="font-semibold text-muted-foreground/80">
            Risk varies by strategy.{" "}
          </span>
          Stability Pool deposits may be partially converted to collateral
          during liquidations. LP positions are subject to impermanent loss and
          pool imbalance. Higher APY generally correlates with higher risk.
          Review each strategy&apos;s mechanics before depositing.
        </div>
      </div>

      {/* Footer link */}
      <div className="pt-2 text-center">
        <a
          href="https://docs.mento.org/mento/mento-protocol/earn"
          target="_blank"
          rel="noopener noreferrer"
          className="gap-1.5 text-xs inline-flex items-center text-primary hover:underline"
        >
          Read the full guide to earning on Mento
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="bottom-decorations after:-bottom-15 before:-bottom-5 before:-right-5 before:h-5 before:w-5 after:right-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-card before:invert after:absolute after:block after:bg-card" />
    </div>
  );
}
