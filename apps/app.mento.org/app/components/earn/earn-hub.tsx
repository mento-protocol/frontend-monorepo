"use client";

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  getStabilityRoute,
  getSupportedDeployments,
} from "@/lib/stability-route";
import { withOpportunitySource } from "@/lib/opportunity-navigation";
import { Card, CardContent, cn } from "@repo/ui";
import {
  useStabilityPool,
  useStabilityPoolApy,
  useStabilityPoolStats,
  useAllPoolsList,
  usePoolRewards,
  getPoolRewardKey,
  chainIdToSlug,
  chainIdToChain,
  ChainId,
  useVisibleChains,
  type ChainFilterType,
  getPoolDisplayOrder,
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

type EarnFilter = "all" | "stability" | "lp";

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

function buildStabilityOpportunity({
  chainId,
  debtToken,
  debtTokenAddress,
  isConnected,
  position,
  totalDeposits,
  apy,
  avgInterestRate,
}: {
  chainId: ChainId;
  debtToken: { symbol: string; collateralSymbol: string };
  debtTokenAddress?: `0x${string}`;
  isConnected: boolean;
  position:
    | {
        deposit: bigint;
        debtTokenGain: bigint;
        collateralGain: bigint;
      }
    | null
    | undefined;
  totalDeposits: bigint | null | undefined;
  apy: number | null | undefined;
  avgInterestRate: number | null | undefined;
}): StabilityOpportunity {
  const hasDeposit = (position?.deposit ?? 0n) > 0n;
  const hasRewards =
    (position?.debtTokenGain ?? 0n) > 0n ||
    (position?.collateralGain ?? 0n) > 0n;
  const apyValue = apy != null ? apy * 100 : 0;
  const avgRate = avgInterestRate != null ? avgInterestRate * 100 : 0;
  const totalDep = formatCompactToken(totalDeposits ?? null, debtToken.symbol);

  let userPosition = null;
  if (isConnected && (hasDeposit || hasRewards)) {
    const deposited = formatCompactToken(
      position?.deposit ?? 0n,
      debtToken.symbol,
    );
    const rewardParts: string[] = [];
    if (position?.debtTokenGain && position.debtTokenGain > 0n) {
      rewardParts.push(
        formatCompactToken(position.debtTokenGain, debtToken.symbol),
      );
    }
    if (position?.collateralGain && position.collateralGain > 0n) {
      rewardParts.push(
        formatCompactToken(position.collateralGain, debtToken.collateralSymbol),
      );
    }
    userPosition = {
      deposited,
      rewards: rewardParts.length > 0 ? rewardParts.join(" + ") : undefined,
    };
  }

  return {
    id: `sp-${chainId}-${debtToken.symbol.toLowerCase()}`,
    type: "stability",
    chainId,
    name: `${debtToken.symbol} Stability Pool`,
    token: {
      address: debtTokenAddress ?? "",
      symbol: debtToken.symbol,
    },
    apy: apyValue,
    apyLabel: "Pool APY",
    hasRewards,
    earnMechanics: [
      { label: "Liquidation gains", color: "green" },
      { label: "Protocol yield", color: "indigo" },
      {
        label: "Trove interest",
        color: "amber",
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
    href: withOpportunitySource(
      getStabilityRoute(debtToken.symbol, chainId),
      "earn",
    ),
  };
}

interface StabilityOpportunityState {
  position:
    | {
        deposit: bigint;
        debtTokenGain: bigint;
        collateralGain: bigint;
      }
    | null
    | undefined;
  totalDeposits: bigint | null | undefined;
  apy: number | null | undefined;
  avgInterestRate: number | null | undefined;
}

export function EarnHub() {
  const [filter, setFilter] = useState<EarnFilter>("all");
  const [chainFilter, setChainFilter] = useState<ChainFilterType>("all");

  const { isConnected } = useAccount();
  const visiblePoolChains = useVisibleChains("pools");
  const visibleStabilityChains = useVisibleChains("stabilityPool");
  const [stabilityStates, setStabilityStates] = useState<
    Record<string, StabilityOpportunityState>
  >({});
  const supportedDeployments = useMemo(
    () =>
      getSupportedDeployments().filter(({ chainId }) =>
        visibleStabilityChains.includes(chainId),
      ),
    [visibleStabilityChains],
  );

  // LP Pool data — fetches across all chains
  const { data: pools = [] } = useAllPoolsList();
  const { rewards } = usePoolRewards();
  const visibleEarnChains = useMemo(() => {
    const chainIds = new Set<ChainId>([
      ...visiblePoolChains,
      ...visibleStabilityChains,
    ]);
    return Array.from(chainIds);
  }, [visiblePoolChains, visibleStabilityChains]);
  const selectedChainFilter =
    chainFilter !== "all" && !visibleEarnChains.includes(chainFilter)
      ? "all"
      : chainFilter;

  const stabilityOpportunities: StabilityOpportunity[] = useMemo(() => {
    return supportedDeployments.map(({ chainId, token }) => {
      const stateKey = `${chainId}:${token.symbol}`;
      const state = stabilityStates[stateKey];
      let debtTokenAddress: `0x${string}` | undefined;

      try {
        debtTokenAddress = getTokenAddress(
          chainId,
          token.symbol as TokenSymbol,
        ) as `0x${string}`;
      } catch {
        debtTokenAddress = undefined;
      }

      return buildStabilityOpportunity({
        chainId,
        debtToken: token,
        debtTokenAddress,
        isConnected,
        position: state?.position ?? null,
        totalDeposits: state?.totalDeposits,
        apy: state?.apy,
        avgInterestRate: state?.avgInterestRate,
      });
    });
  }, [supportedDeployments, stabilityStates, isConnected]);

  // Build LP pool opportunities
  const lpOpportunities: LpOpportunity[] = useMemo(() => {
    // Only show FPMM pools (Legacy pools don't support liquidity actions)
    const fpmmPools = pools.filter((p) => p.poolType === "FPMM");

    return fpmmPools.map((pool) => {
      const rewardKey = getPoolRewardKey(pool.chainId, pool.poolAddr);
      const reward = rewards.get(rewardKey);
      const hasReward = !!reward;

      const lpFeePercent = pool.fees.lp;
      const rewardApr = reward?.apr ?? 0;
      const totalApr = lpFeePercent + rewardApr;

      const mechanics: LpOpportunity["earnMechanics"] = [
        {
          label: "Swap fees",
          color: "indigo",
          value: `${lpFeePercent.toFixed(2)}%`,
        },
      ];
      if (hasReward) {
        mechanics.push({
          label: "Merkl rewards",
          color: "green",
          value: `+${rewardApr.toFixed(1)}%`,
        });
      }

      const tvlDisplay = pool.tvl != null ? formatCompactUsd(pool.tvl) : "—";
      const slug = chainIdToSlug(pool.chainId);

      const { displayToken0, displayToken1 } = getPoolDisplayOrder(pool);

      return {
        id: `lp-${pool.chainId}-${pool.poolAddr.toLowerCase()}`,
        type: "lp" as const,
        chainId: pool.chainId,
        name: `${displayToken0.symbol} / ${displayToken1.symbol}`,
        tokenA: {
          address: displayToken0.address,
          symbol: displayToken0.symbol,
        },
        tokenB: {
          address: displayToken1.address,
          symbol: displayToken1.symbol,
        },
        apy: totalApr,
        apyLabel: "Total APR",
        hasRewards: hasReward,
        earnMechanics: mechanics,
        stats: [
          { label: "TVL", value: tvlDisplay },
          { label: "LP fee", value: `${lpFeePercent.toFixed(2)}%` },
          { label: "Lock-up", value: "None" },
        ],
        userPosition: null, // LP user positions require per-pool balance lookups; shown on pool detail page
        href: withOpportunitySource(`/pools/${slug}/${pool.poolAddr}`, "earn"),
      };
    });
  }, [pools, rewards]);

  // Combine and filter/sort
  const allOpportunities: Opportunity[] = useMemo(() => {
    return [...stabilityOpportunities, ...lpOpportunities];
  }, [stabilityOpportunities, lpOpportunities]);

  const filtered = useMemo(() => {
    let result = allOpportunities;

    if (filter === "stability")
      result = result.filter((o) => o.type === "stability");
    if (filter === "lp") result = result.filter((o) => o.type === "lp");

    if (selectedChainFilter !== "all") {
      result = result.filter((o) => o.chainId === selectedChainFilter);
    }

    // Always sort by highest APY
    result = [...result].sort((a, b) => b.apy - a.apy);

    return result;
  }, [allOpportunities, filter, selectedChainFilter]);

  const filterOptions: { key: EarnFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "stability", label: "Stability Pool" },
    { key: "lp", label: "Liquidity Pools" },
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
      {supportedDeployments.map(({ chainId, token }) => (
        <StabilityOpportunityObserver
          key={`${chainId}:${token.symbol}`}
          chainId={chainId}
          tokenSymbol={token.symbol}
          setStabilityStates={setStabilityStates}
        />
      ))}
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
              selectedChainFilter === "all"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            All
          </button>
          {visibleEarnChains.map((id) => {
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
                  selectedChainFilter === id
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
          href="https://docs.mento.org/mento-v3/dive-deeper/protocol-economics"
          target="_blank"
          rel="noopener noreferrer"
          className="gap-1.5 text-xs inline-flex items-center text-primary hover:underline"
        >
          Learn more about the Mento protocol economics
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="bottom-decorations after:-bottom-15 before:-bottom-5 before:-right-5 before:h-5 before:w-5 after:right-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-card before:invert after:absolute after:block after:bg-card" />
    </div>
  );
}

function StabilityOpportunityObserver({
  chainId,
  tokenSymbol,
  setStabilityStates,
}: {
  chainId: ChainId;
  tokenSymbol: string;
  setStabilityStates: Dispatch<
    SetStateAction<Record<string, StabilityOpportunityState>>
  >;
}) {
  const stateKey = `${chainId}:${tokenSymbol}`;
  const { data: position } = useStabilityPool(tokenSymbol, chainId, {
    enabled: true,
  });
  const { data: totalDeposits } = useStabilityPoolStats(tokenSymbol, chainId, {
    enabled: true,
  });
  const { data: apy, avgInterestRate } = useStabilityPoolApy(
    tokenSymbol,
    chainId,
    {
      enabled: true,
    },
  );

  useEffect(() => {
    setStabilityStates((prev) => ({
      ...prev,
      [stateKey]: {
        position,
        totalDeposits,
        apy,
        avgInterestRate,
      },
    }));
  }, [
    apy,
    avgInterestRate,
    position,
    setStabilityStates,
    stateKey,
    totalDeposits,
  ]);

  return null;
}
