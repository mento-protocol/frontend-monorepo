"use client";

import { useEffect, useMemo, useState } from "react";
import { Star, X, ExternalLink } from "lucide-react";
import { Badge, Button } from "@repo/ui";
import {
  getPoolRewardKey,
  type PoolRewardInfo,
  type PoolDisplay,
} from "@repo/web3";

interface RewardsCampaignBannerProps {
  rewards: Map<string, PoolRewardInfo>;
  pools: PoolDisplay[];
}

export function RewardsCampaignBanner({
  rewards,
  pools,
}: RewardsCampaignBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const [tracerPosition, setTracerPosition] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTracerPosition((prev) => (prev + 1) % 100);
    }, 50);

    return () => window.clearInterval(interval);
  }, []);

  const campaign = useMemo(() => {
    let maxApr = 0;
    let latestEnd = 0;
    let eligibleCount = 0;

    for (const pool of pools) {
      const reward = rewards.get(getPoolRewardKey(pool.chainId, pool.poolAddr));
      if (!reward) continue;
      eligibleCount++;
      if (reward.apr > maxApr) maxApr = reward.apr;
      if (reward.campaignEnd > latestEnd) latestEnd = reward.campaignEnd;
    }

    if (eligibleCount === 0) return null;

    const daysRemaining = Math.max(
      0,
      Math.ceil((latestEnd * 1000 - mountedAt) / (1000 * 60 * 60 * 24)),
    );

    return { maxApr, eligibleCount, daysRemaining };
  }, [mountedAt, rewards, pools]);

  if (!campaign || dismissed) return null;

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div
        className="inset-0 pointer-events-none absolute overflow-hidden rounded-lg"
        style={{
          background: `conic-gradient(from ${
            tracerPosition * 3.6
          }deg, transparent 0deg, transparent 328deg, oklch(0.5116 0.2893 289.05 / 0.96) 340deg, oklch(0.5116 0.2893 289.05 / 0.22) 350deg, transparent 360deg)`,
          padding: "1px",
        }}
      >
        <div className="h-full w-full rounded-lg border border-border/70 bg-card" />
      </div>

      <div className="gap-4 p-4 md:flex-row md:items-center md:justify-between md:px-5 relative z-10 flex flex-col rounded-lg">
        <div className="gap-4 flex items-start">
          <div className="h-12 w-12 relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/80 bg-background/30">
            <div className="inset-0 absolute bg-[radial-gradient(circle_at_30%_25%,rgba(16,185,129,0.16),transparent_62%)]" />
            <Star
              className="h-5 w-5 text-emerald-400 relative drop-shadow-[0_0_8px_rgba(16,185,129,0.22)]"
              strokeWidth={2.25}
            />
          </div>

          <div className="min-w-0">
            <div className="gap-2 flex flex-wrap items-center">
              <span className="text-lg font-semibold tracking-tight text-foreground">
                MENTO Rewards Campaign
              </span>
              <Badge
                variant="secondary"
                className="gap-1 border-emerald-400/20 bg-emerald-500/10 px-2 py-0 font-mono text-emerald-400 border text-[10px] tracking-[0.18em] uppercase"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                Live
              </Badge>
            </div>

            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Earn up to{" "}
              <span className="font-semibold text-emerald-400">
                {campaign.maxApr.toFixed(1)}% APR
              </span>{" "}
              through live Merkl campaigns on{" "}
              <span className="text-foreground">
                {campaign.eligibleCount} eligible pool
                {campaign.eligibleCount !== 1 ? "s" : ""}
              </span>
              .
            </p>
          </div>
        </div>

        <div className="gap-2 md:self-auto flex shrink-0 items-center self-end">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 px-4 border-border/70 bg-background/20 hover:bg-accent/70"
            asChild
          >
            <a
              href="https://app.merkl.xyz/protocols/mento"
              target="_blank"
              rel="noopener noreferrer"
            >
              Campaign Details
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1 text-muted-foreground/70 transition-colors hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
