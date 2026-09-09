// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ProposalState = { Active: "Active" };
vi.mock("@/graphql/subgraph/generated/subgraph", () => ({
  ProposalState: { Active: "Active" },
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("@repo/web3", () => ({
  ConnectButton: ({ text, disabled }: { text: string; disabled?: boolean }) => (
    <button disabled={disabled}>{text}</button>
  ),
}));
vi.mock("@mento-protocol/ui", () => ({
  Button: ({
    children,
    clipped: _clipped,
    size: _size,
    variant: _variant,
    asChild: _asChild,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    clipped?: string;
    size?: string;
    variant?: string;
    asChild?: boolean;
  }) => {
    void _clipped;
    void _size;
    void _variant;
    void _asChild;
    return <button {...props}>{children}</button>;
  },
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
vi.mock("@/components/voting/vote-card-cancel-actions", () => ({
  VoteCardCancelActions: () => <span>cancel actions</span>,
}));

import { VoteCardActions } from "./vote-card-actions";

type VoteCardActionsProps = React.ComponentProps<typeof VoteCardActions>;
const onVote = vi.fn();

const base = {
  currentState: "ready",
  address: "0xabc",
  proposal: {},
  proposalState: ProposalState.Active,
  hasVoted: false,
  isVotedForApprove: false,
  isVotedForAbstain: false,
  isVotedForReject: false,
  queueEndTime: null,
  isVetoPeriodOver: false,
  isDeadlinePassed: false,
  isAwaitingUserSignature: false,
  isConfirming: false,
  isAwaitingExecuteSignature: false,
  isExecuteConfirming: false,
  isAwaitingQueueSignature: false,
  isQueueConfirming: false,
  onExecute: vi.fn(),
  onQueue: vi.fn(),
  onVote,
  watchdogCancelAction: {},
  proposerCancelAction: {},
} as unknown as VoteCardActionsProps;

function renderActions(overrides: Record<string, unknown>) {
  const props = { ...base, ...overrides } as VoteCardActionsProps;
  return render(<VoteCardActions {...props} />);
}
afterEach(cleanup);

describe("VoteCardActions", () => {
  it.each(["loading", "confirming", "signing", "other"])(
    "renders nothing for %s",
    (currentState) => {
      const { container } = renderActions({ currentState });
      expect(container.innerHTML).toBe("");
    },
  );

  it("links an insufficient voter to locking", () => {
    renderActions({ currentState: "insufficient-mento" });
    expect(
      screen
        .getByRole("link", { name: "Lock MENTO Tokens" })
        .getAttribute("href"),
    ).toBe("/voting-power");
  });

  it.each([
    ["approve", { isVotedForApprove: true }, "Your vote: YES"],
    ["abstain", { isVotedForAbstain: true }, "Your vote: Abstain"],
    ["reject", { isVotedForReject: true }, "Your vote: NO"],
  ])("shows a recorded %s vote", (_name, vote, label) => {
    renderActions({ currentState: "voted", hasVoted: true, ...vote });
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  });

  it("hides a finished state without a vote", () => {
    const { container } = renderActions({
      currentState: "finished",
      hasVoted: false,
    });
    expect(container.innerHTML).toBe("");
  });

  it("handles queued disconnected and veto-period states", () => {
    const { rerender } = renderActions({
      currentState: "queued",
      address: undefined,
      queueEndTime: new Date(),
      isVetoPeriodOver: true,
    });
    expect(
      screen.getByRole("button", { name: "Connect Wallet to Execute" }),
    ).toBeTruthy();
    rerender(
      <VoteCardActions {...base} currentState="queued" address={undefined} />,
    );
    expect(
      screen.getByRole("button", { name: "Proposal Queued" }),
    ).toBeTruthy();
    rerender(<VoteCardActions {...base} currentState="queued" />);
    expect(screen.getByRole("button", { name: "In Veto Period" })).toBeTruthy();
  });

  it("executes a queued proposal through each pending state", () => {
    const { rerender } = renderActions({
      currentState: "queued",
      queueEndTime: new Date(),
      isVetoPeriodOver: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Execute Proposal" }));
    expect(base.onExecute).toHaveBeenCalled();
    rerender(
      <VoteCardActions
        {...base}
        currentState="queued"
        queueEndTime={new Date()}
        isVetoPeriodOver
        isAwaitingExecuteSignature
      />,
    );
    expect(
      screen.getByRole("button", { name: "Confirm in Wallet" }),
    ).toBeTruthy();
    rerender(
      <VoteCardActions
        {...base}
        currentState="queued"
        queueEndTime={new Date()}
        isVetoPeriodOver
        isExecuteConfirming
      />,
    );
    expect(screen.getByRole("button", { name: "Executing..." })).toBeTruthy();
  });

  it("shows executed proposal evidence or fallback", () => {
    const { rerender } = renderActions({
      currentState: "executed",
      proposal: { proposalExecuted: [{ transaction: { id: "0xexecute" } }] },
    });
    expect(
      screen.getByRole("link", { name: "View Execution Transaction" }),
    ).toBeTruthy();
    rerender(<VoteCardActions {...base} currentState="executed" />);
    expect(
      screen.getByRole("button", { name: "Proposal Executed" }),
    ).toBeTruthy();
  });

  it("queues a succeeded proposal through each pending state", () => {
    const { rerender } = renderActions({
      currentState: "succeeded",
      address: undefined,
    });
    expect(
      screen.getByRole("button", { name: "Connect Wallet to Queue" }),
    ).toBeTruthy();
    rerender(<VoteCardActions {...base} currentState="succeeded" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Queue for Execution" }),
    );
    expect(base.onQueue).toHaveBeenCalled();
    rerender(
      <VoteCardActions
        {...base}
        currentState="succeeded"
        isAwaitingQueueSignature
      />,
    );
    expect(
      screen.getByRole("button", { name: "Confirm in Wallet" }),
    ).toBeTruthy();
    rerender(
      <VoteCardActions {...base} currentState="succeeded" isQueueConfirming />,
    );
    expect(screen.getByRole("button", { name: "Queueing..." })).toBeTruthy();
  });

  it("renders pending voting actions", () => {
    renderActions({ currentState: "pending" });
    expect(
      screen.getAllByRole("button", { name: "Voting Not Started" }),
    ).toHaveLength(3);
  });

  it("connects or casts every ready vote", () => {
    const { rerender } = renderActions({
      currentState: "ready",
      address: undefined,
    });
    expect(
      screen.getByRole("button", { name: "Connect Wallet to Vote" }),
    ).toBeTruthy();
    rerender(<VoteCardActions {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Vote YES" }));
    fireEvent.click(screen.getByRole("button", { name: "Abstain" }));
    fireEvent.click(screen.getByRole("button", { name: "Vote NO" }));
    expect(onVote.mock.calls.map((call) => call[0])).toEqual([1, 2, 0]);
    rerender(<VoteCardActions {...base} isDeadlinePassed />);
    expect(
      (screen.getByRole("button", { name: "Vote YES" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
