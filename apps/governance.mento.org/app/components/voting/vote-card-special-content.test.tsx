// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mento-protocol/ui", () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IconLoading: () => <span>loading</span>,
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

import { VoteCardSpecialContent } from "./vote-card-special-content";

type VoteCardSpecialContentProps = React.ComponentProps<
  typeof VoteCardSpecialContent
>;

const base = {
  currentState: "loading",
  isAwaitingExecuteSignature: false,
  isAwaitingQueueSignature: false,
  isExecuteConfirming: false,
  isQueueConfirming: false,
  voteSupport: undefined,
  currentTxHash: undefined,
  hash: undefined,
  executeHash: undefined,
  queueHash: undefined,
} as VoteCardSpecialContentProps;
function renderSpecial(overrides: Record<string, unknown>) {
  const props = { ...base, ...overrides } as VoteCardSpecialContentProps;
  return render(<VoteCardSpecialContent {...props} />);
}
afterEach(cleanup);

describe("VoteCardSpecialContent", () => {
  it("hides ordinary states and loads voting data", () => {
    const { container, rerender } = renderSpecial({ currentState: "ready" });
    expect(container.innerHTML).toBe("");
    rerender(<VoteCardSpecialContent {...base} />);
    expect(screen.getByText("Loading voting information...")).toBeTruthy();
  });

  it.each([
    [1, "YES"],
    [0, "NO"],
    [2, "ABSTAIN"],
  ])("describes vote support %s", (voteSupport, label) => {
    renderSpecial({ currentState: "signing", voteSupport });
    expect(screen.getByText(new RegExp(label))).toBeTruthy();
    expect(screen.getByText("Waiting for confirmation...")).toBeTruthy();
  });

  it("describes execution and queue signatures", () => {
    const { rerender } = renderSpecial({
      currentState: "signing",
      isAwaitingExecuteSignature: true,
    });
    expect(
      screen.getByText("Waiting for execution confirmation..."),
    ).toBeTruthy();
    expect(screen.getByText("You are executing this proposal")).toBeTruthy();
    rerender(
      <VoteCardSpecialContent
        {...base}
        currentState="signing"
        isAwaitingQueueSignature
      />,
    );
    expect(screen.getByText("Waiting for queue confirmation...")).toBeTruthy();
    expect(
      screen.getByText("You are queueing this proposal for execution"),
    ).toBeTruthy();
  });

  it("describes vote, queue, and execution confirmation", () => {
    const { rerender } = renderSpecial({ currentState: "confirming" });
    expect(screen.getByText("Your vote is being processed")).toBeTruthy();
    rerender(
      <VoteCardSpecialContent
        {...base}
        currentState="confirming"
        isExecuteConfirming
      />,
    );
    expect(screen.getByText("Proposal is being executed")).toBeTruthy();
    rerender(
      <VoteCardSpecialContent
        {...base}
        currentState="confirming"
        isQueueConfirming
      />,
    );
    expect(screen.getByText("Proposal is being queued")).toBeTruthy();
  });

  it("links a confirming transaction for each hash source", () => {
    const { rerender } = renderSpecial({
      currentState: "confirming",
      currentTxHash: "0xtx",
      hash: "0xvote",
    });
    expect(screen.getByRole("link", { name: "View on explorer" })).toBeTruthy();
    rerender(
      <VoteCardSpecialContent
        {...base}
        currentState="confirming"
        currentTxHash="0xtx"
        executeHash="0xexecute"
      />,
    );
    expect(screen.getByRole("link", { name: "View on explorer" })).toBeTruthy();
    rerender(
      <VoteCardSpecialContent
        {...base}
        currentState="confirming"
        currentTxHash="0xtx"
        queueHash="0xqueue"
      />,
    );
    expect(screen.getByRole("link", { name: "View on explorer" })).toBeTruthy();
  });
});
