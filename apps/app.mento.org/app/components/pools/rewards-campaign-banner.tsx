"use client";

import { useState, useMemo } from "react";
import { Star, X, ExternalLink } from "lucide-react";
import { Badge, Button } from "@repo/ui";
import type { PoolRewardInfo, PoolDisplay } from "@repo/web3";

interface RewardsCampaignBannerProps {
  rewards: Map<string, PoolRewardInfo>;
  pools: PoolDisplay[];
}

export function RewardsCampaignBanner({
  rewards,
  pools,
}: RewardsCampaignBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  const campaign = useMemo(() => {
    let maxApr = 0;
    let earliestEnd = Infinity;
    let eligibleCount = 0;

    for (const pool of pools) {
      const reward = rewards.get(pool.poolAddr.toLowerCase());
      if (!reward) continue;
      eligibleCount++;
      if (reward.apr > maxApr) maxApr = reward.apr;
      if (reward.campaignEnd < earliestEnd) earliestEnd = reward.campaignEnd;
    }

    if (eligibleCount === 0) return null;

    const daysRemaining = Math.max(
      0,
      Math.ceil((earliestEnd * 1000 - Date.now()) / (1000 * 60 * 60 * 24)),
    );

    return { maxApr, eligibleCount, daysRemaining };
  }, [rewards, pools]);

  if (!campaign || dismissed) return null;

  return (
    <div className="gap-4 p-4 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5">
      <div className="gap-3 flex items-center">
        <div className="h-10 w-10 flex shrink-0 items-center justify-center rounded-lg bg-primary/15">
          <Star className="h-5 w-5 fill-primary text-primary" />
        </div>
        <div>
          <div className="gap-2 flex items-center">
            <span className="text-sm font-semibold">
              MENTO Rewards Campaign
            </span>
            <Badge
              variant="secondary"
              className="gap-1 px-1.5 py-0 bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[10px]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              LIVE
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Earn up to{" "}
            <span className="font-semibold text-foreground">
              {campaign.maxApr.toFixed(1)}% APR
            </span>{" "}
            in MENTO rewards on {campaign.eligibleCount} eligible pool
            {campaign.eligibleCount !== 1 ? "s" : ""}.
            {campaign.daysRemaining > 0 &&
              ` Ends in ${campaign.daysRemaining} day${campaign.daysRemaining !== 1 ? "s" : ""}.`}
          </p>
        </div>
      </div>
      <div className="gap-2 flex shrink-0 items-center">
        <Button variant="outline" size="sm" className="gap-1.5" asChild>
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
          className="p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
