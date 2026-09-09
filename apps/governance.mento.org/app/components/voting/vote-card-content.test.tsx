// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ProposalState = {
  Pending: "Pending",
  Active: "Active",
  Succeeded: "Succeeded",
  Defeated: "Defeated",
  Queued: "Queued",
  Executed: "Executed",
  Canceled: "Canceled",
  Expired: "Expired",
};
vi.mock("@/graphql/subgraph/generated/subgraph", () => ({
  ProposalState: {
    Pending: "Pending",
    Active: "Active",
    Succeeded: "Succeeded",
    Defeated: "Defeated",
    Queued: "Queued",
    Executed: "Executed",
    Canceled: "Canceled",
    Expired: "Expired",
  },
}));
vi.mock("@mento-protocol/ui", () => {
  const Box = ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>;
  return {
    Card: Box,
    CardContent: Box,
    CardDescription: Box,
    CardHeader: Box,
    CardTitle: Box,
  };
});
vi.mock("lucide-react", () => ({
  CheckCircle2: () => <span>check</span>,
  CircleCheck: () => <span>approved</span>,
  XCircle: () => <span>rejected</span>,
  XCircleIcon: () => <span>cancel icon</span>,
}));
vi.mock("@/components/progress-bar", () => ({
  ProgressBar: () => <span>progress</span>,
}));
vi.mock("@/components/proposal/components/TransactionLink", () => ({
  TransactionLink: ({
    children,
    txHash,
  }: {
    children: React.ReactNode;
    txHash: string;
  }) => <a href={`/${txHash}`}>{children}</a>,
}));
vi.mock("@/components/timer", () => ({
  Timer: ({ label }: { label?: string }) => <span>{label ?? "timer"}</span>,
}));
vi.mock("@/components/voting/vote-card-actions", () => ({
  VoteCardActions: ({ currentState }: { currentState: string }) => (
    <span>actions:{currentState}</span>
  ),
}));
vi.mock("@/components/voting/vote-card-special-content", () => ({
  VoteCardSpecialContent: ({ currentState }: { currentState: string }) => (
    <span>special:{currentState}</span>
  ),
}));

import { VoteCardContent } from "./vote-card-content";

type VoteCardContentProps = React.ComponentProps<typeof VoteCardContent>;

const base = {
  currentState: "ready",
  proposal: { proposalCanceled: [] },
  proposalState: ProposalState.Active,
  votingDeadline: new Date("2027-01-01"),
  address: "0xabc",
  isConnected: true,
  isVotingOpen: true,
  hasQuorum: true,
  forVotes: 10,
  againstVotes: 5,
  abstainVotes: 1,
  quorumNeededFormatted: "100",
  formattedVeMentoBalance: "20",
  formattedTotalVotingPower: "30",
  voteData: {
    mode: "vote",
    approve: { value: "10", percentage: 60 },
    reject: { value: "5", percentage: 40 },
  },
  hasVoted: false,
  pendingVoteSupport: undefined,
  recordedVoteSupport: undefined,
  queueEndTime: null,
  isVetoPeriodOver: false,
  isDeadlinePassed: false,
  isAwaitingUserSignature: false,
  isConfirming: false,
  isAwaitingExecuteSignature: false,
  isExecuteConfirming: false,
  isAwaitingQueueSignature: false,
  isQueueConfirming: false,
  currentTxHash: undefined,
  hash: undefined,
  executeHash: undefined,
  queueHash: undefined,
  onExecute: vi.fn(),
  onQueue: vi.fn(),
  onVote: vi.fn(),
  isWatchdogSafe: true,
  isWatchdog: false,
  hasPendingCancellation: false,
  isPendingCancellationStatusUnavailable: false,
  onWatchdogCancel: vi.fn(),
  isAwaitingCancelSignature: false,
  isCancelConfirming: false,
  signaturesCollected: 0,
  signaturesRequired: 2,
  chainId: 42220,
  watchdogAddress: "0xsafe",
  canProposerCancel: false,
  onProposerCancel: vi.fn(),
  isAwaitingProposerCancelSignature: false,
  isProposerCancelConfirming: false,
  isProposerCancelConfirmed: false,
  activeTransactionError: null,
} as unknown as VoteCardContentProps;

function renderCard(overrides: Record<string, unknown>) {
  const props = { ...base, ...overrides } as VoteCardContentProps;
  return render(<VoteCardContent {...props} />);
}

afterEach(cleanup);

describe("VoteCardContent", () => {
  it.each([
    ["loading", null],
    ["confirming", null],
    ["signing", null],
    ["insufficient-mento", "Lock MENTO to Vote"],
    ["executed", "Proposal Executed"],
    ["queued", "Proposal Queued"],
    ["succeeded", "Proposal Succeeded"],
    ["canceled", "Proposal Canceled"],
    ["expired", "Proposal Expired"],
    ["pending", "Voting Pending"],
    ["finished", "Voting Finished"],
    ["ready", "Voting is Open"],
  ])("renders %s state", (currentState, title) => {
    renderCard({ currentState });
    expect(screen.getByText(`special:${currentState}`)).toBeTruthy();
    if (title) expect(screen.getByText(title)).toBeTruthy();
  });

  it("renders all defeated descriptions", () => {
    const { rerender } = renderCard({
      currentState: "defeated",
      proposalState: ProposalState.Defeated,
      hasQuorum: false,
      forVotes: 10,
      againstVotes: 5,
    });
    expect(screen.getByText("Quorum Not Met")).toBeTruthy();
    expect(screen.getByText(/did not reach the required quorum/)).toBeTruthy();
    rerender(
      <VoteCardContent
        {...base}
        currentState="defeated"
        proposalState={ProposalState.Defeated as never}
        hasQuorum
        abstainVotes={20}
        forVotes={5}
        againstVotes={10}
      />,
    );
    expect(screen.getByText("Majority Abstained")).toBeTruthy();
    expect(screen.getByText(/most voters chose to abstain/)).toBeTruthy();
    rerender(
      <VoteCardContent
        {...base}
        currentState="defeated"
        proposalState={ProposalState.Defeated as never}
        hasQuorum
        forVotes={5}
        againstVotes={10}
      />,
    );
    expect(screen.getByText("Proposal Defeated")).toBeTruthy();
    expect(screen.getByText(/did not receive enough YES votes/)).toBeTruthy();
  });

  it("renders canceled transaction variants", () => {
    const proposal = {
      proposalCanceled: [
        { timestamp: "1700000000", transaction: { id: "0xcancel" } },
      ],
    };
    const { rerender } = renderCard({
      currentState: "canceled",
      proposalState: ProposalState.Canceled,
      proposal,
    });
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
    rerender(
      <VoteCardContent
        {...base}
        currentState="canceled"
        proposalState={ProposalState.Canceled as never}
        proposal={{ proposalCanceled: [{ timestamp: "1700000000" }] } as never}
      />,
    );
    expect(screen.getByText("Cancelled:")).toBeTruthy();
    rerender(
      <VoteCardContent
        {...base}
        currentState="canceled"
        proposalState={ProposalState.Canceled as never}
        proposal={{ proposalCanceled: [{}] } as never}
      />,
    );
    expect(screen.getByText("Proposal Canceled")).toBeTruthy();
  });

  it("renders timers, quorum states, vote totals, and active errors", () => {
    const { rerender } = renderCard({
      currentState: "queued",
      proposalState: ProposalState.Queued,
      queueEndTime: new Date("2027-01-01"),
      hasQuorum: false,
      hasVoted: true,
      recordedVoteSupport: 1,
      activeTransactionError: { label: "Queue failed", message: "Try again" },
    });
    expect(screen.getByText("Executable in:")).toBeTruthy();
    expect(screen.getByText("Quorum not yet met")).toBeTruthy();
    expect(screen.getByTestId("totalVotesLabel")).toBeTruthy();
    expect(screen.getByText("Queue failed")).toBeTruthy();
    rerender(<VoteCardContent {...base} recordedVoteSupport={2} hasVoted />);
    expect(screen.getByText("Quorum met")).toBeTruthy();
    rerender(
      <VoteCardContent
        {...base}
        recordedVoteSupport={0}
        hasVoted
        isVotingOpen={false}
        hasQuorum={false}
      />,
    );
    expect(screen.getByText("Quorum not met")).toBeTruthy();
  });

  it("derives watchdog action labels", () => {
    const { rerender } = renderCard({
      isWatchdogSafe: true,
      isAwaitingCancelSignature: true,
    });
    expect(screen.getByText("actions:ready")).toBeTruthy();
    rerender(<VoteCardContent {...base} isWatchdogSafe isCancelConfirming />);
    rerender(<VoteCardContent {...base} isWatchdogSafe={false} />);
  });
});
