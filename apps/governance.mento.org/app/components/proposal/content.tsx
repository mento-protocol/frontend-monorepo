"use client";
import { VoteCard } from "@/components/voting/vote-card";
import { IconLoading } from "@repo/ui";
import { CELO_BLOCK_TIME } from "@repo/web3";
import { ensureChainId } from "@repo/web3";
import { useProposal } from "@/contracts/governor";
import { useAccount, useBlock, useBlockNumber } from "@repo/web3/wagmi";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { ExecutionCode } from "./execution-code/ExecutionCode";
import { isEmptyTransaction } from "./execution-code/patterns/utils";
import { Participants } from "./participants/Participants";
import { ProposalDescription } from "./description/ProposalDescription";
import { ProposalHeader } from "./ProposalHeader";

export const ProposalContent = () => {
  const params = useParams();
  const id = params.id as string;
  const { proposal, refetch: refetchProposal } = useProposal(BigInt(id));
  const { chainId } = useAccount();

  // Only fetch block data if wallet is connected, otherwise use fallback
  const { data: currentBlock } = useBlockNumber({
    chainId: ensureChainId(chainId),
    query: {
      enabled: proposal !== undefined,
      refetchInterval: CELO_BLOCK_TIME,
    },
  });

  const endBlock = useBlock({
    blockNumber: proposal?.endBlock ? BigInt(proposal.endBlock) : 0n,
    query: {
      enabled: proposal !== undefined,
    },
  });

  const votingDeadline = useMemo(() => {
    // Only calculate deadline if we have block data to avoid hydration mismatches (which we only have on the client).
    // This prevents server/client differences when using Date.now() below
    if (!proposal || !currentBlock) return;

    // If the currentBlock is greater than the endBlock, the deadline has passed
    const isDeadlinePassed =
      proposal?.endBlock &&
      endBlock?.data?.timestamp &&
      Number(currentBlock) >= proposal.endBlock;

    if (isDeadlinePassed) {
      return new Date(Number(endBlock?.data?.timestamp) * 1000);
    }

    // If the deadline has not passed, calculate the deadline as the distance between the current block and the end block
    return new Date(
      Date.now() + (proposal.endBlock - Number(currentBlock)) * CELO_BLOCK_TIME,
    );
  }, [currentBlock, endBlock.data, proposal]);

  const transactions = useMemo(() => {
    if (!proposal?.calls || proposal.calls.length === 0) return [];
    return proposal.calls.map((call) => ({
      address: call.target.id,
      value: call.value,
      data: call.calldata,
    }));
  }, [proposal?.calls]);

  // Check if there's meaningful execution code (same logic as ExecutionCode component)
  const hasExecutionCode = useMemo(() => {
    if (transactions.length === 0) return false;

    // If there's more than one transaction, it's meaningful
    if (transactions.length > 1) return true;

    // If there's exactly one transaction, check if it's empty
    return !(
      transactions.length === 1 &&
      transactions[0] &&
      isEmptyTransaction(transactions[0])
    );
  }, [transactions]);

  if (!proposal) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <IconLoading />
      </div>
    );
  }

  return (
    <>
      <ProposalHeader proposal={proposal} votingDeadline={votingDeadline} />

      <div className="gap-8 xl:w-full xl:flex-row xl:gap-10 flex flex-col">
        <div className="xl:w-2/3">
          <VoteCard
            proposal={proposal}
            votingDeadline={votingDeadline}
            onVoteConfirmed={refetchProposal}
          />

          {/* Show execution code above description only when there are meaningful transactions */}
          {hasExecutionCode && (
            <ExecutionCode transactions={transactions} className="mt-4" />
          )}

          <ProposalDescription description={proposal.metadata?.description} />

          {/* Show execution code below description when there are no transactions */}
          {!hasExecutionCode && (
            <ExecutionCode transactions={transactions} className="mt-4" />
          )}
        </div>
        <div className="xl:w-1/3">
          <Participants proposal={proposal} />
        </div>
      </div>
    </>
  );
};
