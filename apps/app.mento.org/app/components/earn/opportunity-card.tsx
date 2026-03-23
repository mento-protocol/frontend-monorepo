"use client";

import Image from "next/image";
import Link from "next/link";
import { Card, CardContent, cn, TokenIcon } from "@repo/ui";
import { chainIdToChain, type ChainId } from "@repo/web3";
import { ChevronRight } from "lucide-react";

export interface EarnMechanic {
  label: string;
  value?: string;
  color: "green" | "indigo" | "amber";
}

export interface EarnStat {
  label: string;
  value: string;
}

export interface UserPositionSummary {
  deposited: string;
  rewards?: string;
}

interface BaseOpportunity {
  id: string;
  name: string;
  chainId: ChainId;
  apy: number;
  apyLabel: string;
  hasRewards: boolean;
  earnMechanics: EarnMechanic[];
  stats: EarnStat[];
  userPosition: UserPositionSummary | null;
  href: string;
}

export interface StabilityOpportunity extends BaseOpportunity {
  type: "stability";
  token: { address: string; symbol: string };
}

export interface LpOpportunity extends BaseOpportunity {
  type: "lp";
  tokenA: { address: string; symbol: string };
  tokenB: { address: string; symbol: string };
}

export type Opportunity = StabilityOpportunity | LpOpportunity;

const mechanicDotColor: Record<EarnMechanic["color"], string> = {
  green: "bg-emerald-400",
  indigo: "bg-indigo-400",
  amber: "bg-amber-400",
};

function ChainIcon({ chainId }: { chainId: ChainId }) {
  const chain = chainIdToChain[chainId];
  const iconUrl = (chain as unknown as Record<string, unknown>)?.iconUrl as
    | string
    | undefined;

  if (!iconUrl) return null;

  return (
    <span
      title={chain?.name ?? ""}
      aria-label={chain?.name ?? ""}
      className="inline-flex"
    >
      <Image
        src={iconUrl}
        alt={chain?.name ?? ""}
        width={16}
        height={16}
        className="h-4 w-4 rounded-full"
        unoptimized
      />
    </span>
  );
}

export function OpportunityCard({ opp }: { opp: Opportunity }) {
  const isStability = opp.type === "stability";

  return (
    <div className="group">
      <Card className="!py-0 !gap-0 relative overflow-hidden transition-colors group-hover:bg-accent/30">
        {opp.hasRewards && (
          <div className="top-0 left-0 right-0 h-0.5 from-emerald-400/40 absolute bg-gradient-to-r to-transparent" />
        )}

        <CardContent className="p-5 space-y-4">
          {/* Header: icon + name + badges + APY */}
          <div className="flex items-start justify-between">
            <div className="gap-3 flex items-center">
              {isStability ? (
                <div className="relative">
                  <TokenIcon
                    token={opp.token}
                    size={38}
                    className="shrink-0 rounded-full"
                  />
                  <div className="h-4 w-4 absolute right-[-2px] bottom-[-2px] flex items-center justify-center rounded-full bg-card">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M6 2v8M2 6h8"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        className="text-emerald-400"
                      />
                    </svg>
                  </div>
                </div>
              ) : (
                <div
                  className="relative flex-shrink-0"
                  style={{ width: 38 + 38 * 0.55, height: 38 }}
                >
                  <div className="top-0 left-0 absolute z-[2]">
                    <TokenIcon
                      token={opp.tokenA}
                      size={38}
                      className="rounded-full"
                    />
                  </div>
                  <div
                    className="top-0 absolute z-[1]"
                    style={{ left: 38 * 0.55 }}
                  >
                    <div className="inline-flex rounded-full border-[2.5px] border-card">
                      <TokenIcon
                        token={opp.tokenB}
                        size={38}
                        className="rounded-full"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <span className="font-semibold tracking-tight text-[16px]">
                  {opp.name}
                </span>
                <div className="gap-1.5 mt-1 flex flex-wrap items-center">
                  <ChainIcon chainId={opp.chainId} />
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 font-mono font-semibold text-[9px]",
                      isStability
                        ? "bg-emerald-400/10 text-emerald-400"
                        : "bg-indigo-400/10 text-indigo-400",
                    )}
                  >
                    {isStability ? "STABILITY POOL" : "FPMM LP"}
                  </span>
                </div>
              </div>
            </div>

            {/* APY */}
            <div className="shrink-0 text-right">
              <div className="text-2xl font-bold tracking-tight text-emerald-400">
                {opp.apy.toFixed(1)}%
              </div>
              <div className="font-mono text-[10px] text-muted-foreground/50">
                {opp.apyLabel}
              </div>
            </div>
          </div>

          {/* How you earn */}
          <div className="p-3 rounded-lg border border-border/30 bg-accent/20">
            <div className="mb-2 font-mono font-semibold tracking-wider text-[10px] text-muted-foreground/50 uppercase">
              How you earn
            </div>
            <div className="gap-2 flex flex-wrap">
              {opp.earnMechanics.map((m, i) => (
                <div
                  key={i}
                  className="gap-1.5 px-2 py-1 flex items-center rounded-md bg-accent/40"
                >
                  <span
                    className={cn(
                      "h-1 w-1 rounded-full",
                      mechanicDotColor[m.color],
                    )}
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {m.label}
                  </span>
                  {m.value && (
                    <span className="font-mono font-semibold text-[11px] text-foreground">
                      {m.value}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Stats row */}
          <div className="gap-6 flex">
            {opp.stats.map((s, i) => (
              <div key={i}>
                <div className="font-mono tracking-wider text-[10px] text-muted-foreground/50 uppercase">
                  {s.label}
                </div>
                <div className="mt-0.5 text-sm font-semibold tracking-tight">
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          {/* User position (if any) */}
          {opp.userPosition && (
            <div className="border-indigo-400/10 bg-indigo-400/5 px-3 py-2.5 flex items-center justify-between rounded-lg border">
              <div className="gap-2 flex items-center">
                <span className="h-1.5 w-1.5 bg-indigo-400 rounded-full" />
                <span className="text-xs text-muted-foreground">
                  Your deposit:
                </span>
                <span className="font-mono font-semibold text-[13px]">
                  {opp.userPosition.deposited}
                </span>
              </div>
              {opp.userPosition.rewards && (
                <div className="gap-1.5 flex items-center">
                  <span className="text-xs text-muted-foreground/60">
                    Rewards:
                  </span>
                  <span className="font-mono font-semibold text-emerald-400 text-[13px]">
                    {opp.userPosition.rewards}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* CTA */}
          <Link
            href={opp.href}
            className={cn(
              "py-3 font-semibold gap-1.5 flex w-full cursor-pointer items-center justify-center rounded-lg border text-[13px] transition-all",
              isStability
                ? "border-emerald-400/15 bg-emerald-400/8 text-emerald-400 group-hover:bg-emerald-400 group-hover:text-white group-hover:border-transparent group-hover:shadow-[0_4px_20px_rgba(0,229,153,0.2)]"
                : "border-indigo-400/15 bg-indigo-400/8 text-indigo-300 group-hover:bg-indigo-500 group-hover:text-white group-hover:border-transparent group-hover:shadow-[0_4px_20px_rgba(99,102,241,0.2)]",
            )}
          >
            {opp.userPosition ? "Manage Position" : "Start Earning"}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
