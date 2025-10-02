"use client";

import { NumbersService } from "@repo/web3";
import { formatUnits } from "viem";
import { useTokens } from "@repo/web3";

export const VoteTitle = () => {
  const { veMentoBalance } = useTokens();

  return (
    <div className="mb-8 md:mb-16">
      <h1
        className="mb-1 text-3xl font-medium md:mb-3 md:text-6xl"
        data-testid="yourVotingPowerTitleLabel"
      >
        Your voting power
      </h1>
      <span className="text-muted-foreground text-xl font-medium md:text-3xl">
        {Number(formatUnits(veMentoBalance.value, 18)).toLocaleString(
          undefined,
          { maximumFractionDigits: 0 },
        )}{" "}
        veMENTO
      </span>
    </div>
  );
};
