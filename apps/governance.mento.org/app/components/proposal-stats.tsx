"use client";
import { IconInfo, Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui";
import { NumbersService, useTokens, ensureChainId } from "@repo/web3";
import { useAllLocks, useLockingWeek } from "@/contracts/locking";
import { useProposals } from "@/contracts/governor";
import { useAccount, useBlockNumber } from "@repo/web3/wagmi";
import { useMemo } from "react";
import { formatUnits } from "viem";

export const ProposalStats = () => {
  const {
    veMentoContractData: { totalSupply },
  } = useTokens();
  const { currentWeek } = useLockingWeek();
  const { locks } = useAllLocks();
  const { proposals } = useProposals();
  const { chainId } = useAccount();

  const currentBlockNumber = useBlockNumber({
    watch: true,
    chainId: ensureChainId(chainId),
  });

  const proposalsEndBlocks: Array<bigint> = proposals.map(
    (proposal) => proposal.endBlock,
  );

  const proposalCount = useMemo(() => {
    return proposalsEndBlocks.length;
  }, [proposalsEndBlocks]);

  const activeProposalCount = useMemo(() => {
    return proposalsEndBlocks.filter(
      (proposalEndBlock) =>
        !currentBlockNumber.data ||
        BigInt(proposalEndBlock.toString()) > BigInt(currentBlockNumber.data),
    ).length;
  }, [proposalsEndBlocks, currentBlockNumber]);

  const totalSupplyParsed = useMemo(() => {
    const totalSupplyNumber = Number(formatUnits(totalSupply || BigInt(0), 18));
    return NumbersService.parseNumericValue(Math.floor(totalSupplyNumber));
  }, [totalSupply]);

  const activeVoters = useMemo(() => {
    if (!locks || !currentWeek) return 0;

    const uniqueVoters = new Set<string>();
    locks.forEach((lock) => {
      if (lock.owner && lock.owner.id) {
        uniqueVoters.add(lock.owner.id);
      }
    });
    return uniqueVoters.size;
  }, [currentWeek, locks]);

  return (
    <section className="xl:px-22 max-w-2xl px-4 md:p-20">
      <h1 className="text-4xl font-medium md:text-6xl">Mento Governance</h1>
      <p className="mt-2 max-w-[440px] text-muted-foreground">
        Participate in the governance process of the Mento Platform.
      </p>
      <div className="mb-8 mt-8 lg:mb-16 lg:mt-16 xl:mb-0">
        <div className="flex items-center justify-between">
          <span className="gap-2 flex flex-row items-center justify-start text-muted-foreground">
            Total Proposals
            <Tooltip>
              <TooltipTrigger>
                <IconInfo />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>
                  The total number of governance proposals submitted to the
                  Mento platform.
                </p>
              </TooltipContent>
            </Tooltip>
          </span>
          <span className="leading-0 text-lg">{proposalCount}</span>
        </div>
        <hr className="my-3 lg:my-4 border-[var(--border)]" />
        <div className="flex items-center justify-between">
          <span className="gap-2 flex flex-row items-center justify-start text-muted-foreground">
            Active Proposals
            <Tooltip>
              <TooltipTrigger>
                <IconInfo />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>
                  The number of governance proposals currently open for voting
                  or under discussion.
                </p>
              </TooltipContent>
            </Tooltip>
          </span>
          <span className="leading-0 text-lg">{activeProposalCount}</span>
        </div>
        <hr className="my-3 lg:my-4 border-[var(--border)]" />
        <div className="flex items-center justify-between">
          <span className="gap-2 flex flex-row items-center justify-start text-muted-foreground">
            Voters
            <Tooltip>
              <TooltipTrigger>
                <IconInfo />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>
                  The total number of unique addresses that have participated in
                  voting on Mento governance proposals.
                </p>
              </TooltipContent>
            </Tooltip>
          </span>
          <span className="leading-0 text-lg">{activeVoters}</span>
        </div>
        <hr className="my-3 lg:my-4 border-[var(--border)]" />
        <div className="flex items-center justify-between">
          <span className="gap-2 flex flex-row items-center justify-start text-muted-foreground">
            Total veMento Voting Power
            <Tooltip>
              <TooltipTrigger>
                <IconInfo />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>
                  The sum of all veMento tokens, representing the total voting
                  power in the Mento governance system.
                </p>
              </TooltipContent>
            </Tooltip>
          </span>
          <span className="leading-0 text-lg">{totalSupplyParsed}</span>
        </div>
      </div>
    </section>
  );
};
