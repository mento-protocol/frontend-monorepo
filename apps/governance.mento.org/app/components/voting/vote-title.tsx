"use client";

import { useLocksByAccount } from "@/contracts";
import { useVeMentoDelegationSummary } from "@/hooks/use-ve-mento-delegation-summary";
import { useAccount } from "@repo/web3/wagmi";
import { useMemo } from "react";

export const VoteTitle = () => {
  const { address } = useAccount();

  // Get locks for delegation calculation
  const { locks } = useLocksByAccount({
    account: address as string,
  });

  // Calculate total voting power including received delegations
  const { ownVe, receivedVe } = useVeMentoDelegationSummary({ locks, address });

  // Total voting power = own veMENTO + received delegated veMENTO
  const totalVotingPower = useMemo(() => {
    return ownVe + receivedVe;
  }, [ownVe, receivedVe]);

  return (
    <div className="mb-8 md:mb-16">
      <h1
        className="mb-1 font-medium md:mb-3 md:text-6xl text-3xl"
        data-testid="yourVotingPowerTitleLabel"
      >
        Your voting power
      </h1>
      <span className="text-xl font-medium md:text-3xl text-muted-foreground">
        {totalVotingPower.toLocaleString(undefined, {
          maximumFractionDigits: 3,
        })}{" "}
        veMENTO
      </span>
    </div>
  );
};
