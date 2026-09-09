// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const states = {
  Pending: "Pending",
  Active: "Active",
  Succeeded: "Succeeded",
  Defeated: "Defeated",
  Queued: "Queued",
  Executed: "Executed",
  Canceled: "Canceled",
  Expired: "Expired",
};
type Proposal = {
  proposalId: string;
  metadata: { title: string };
  state?: string;
  proposalCreated: Array<{ timestamp: string }>;
  votes: {
    for: { total: bigint };
    against: { total: bigint };
    abstain: { total: bigint };
  };
};
const mocks = vi.hoisted(() => ({
  balance: 100n,
  balanceLoading: false,
  error: null as Error | null,
  loading: false,
  proposals: [] as Proposal[],
  refetch: vi.fn(),
  threshold: 50n,
  thresholdLoading: false,
}));

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
vi.mock("@/contracts/governor", () => ({
  useProposalThreshold: () => ({
    proposalThreshold: mocks.threshold,
    isLoadingProposalThreshold: mocks.thresholdLoading,
  }),
  useProposals: () => ({
    proposals: mocks.proposals,
    isLoading: mocks.loading,
    error: mocks.error,
    refetchProposals: mocks.refetch,
  }),
}));
vi.mock("@repo/web3", () => ({
  NumbersService: { parseNumericValue: (value: number) => `votes:${value}` },
  useTokens: () => ({
    veMentoBalance: { value: mocks.balance },
    isBalanceLoading: mocks.balanceLoading,
  }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@mento-protocol/ui", () => {
  const Box = ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>;
  const PageLink = ({
    children,
    isActive: _isActive,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    isActive?: boolean;
  }) => {
    void _isActive;
    return <a {...props}>{children}</a>;
  };
  return {
    Button: ({
      children,
      clipped: _clipped,
      size: _size,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      clipped?: string;
      size?: string;
    }) => {
      void _clipped;
      void _size;
      return <button {...props}>{children}</button>;
    },
    Checkbox: ({
      checked,
      onCheckedChange,
    }: {
      checked: boolean;
      onCheckedChange: (checked: boolean | string) => void;
    }) => (
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
    ),
    IconChevron: () => <span>chevron</span>,
    IconLoading: () => <span>loading</span>,
    Pagination: Box,
    PaginationContent: Box,
    PaginationItem: Box,
    PaginationLink: PageLink,
    PaginationNext: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a {...props}>next</a>
    ),
    PaginationPrevious: (
      props: React.AnchorHTMLAttributes<HTMLAnchorElement>,
    ) => <a {...props}>previous</a>,
    ProposalCard: Box,
    ProposalCardBody: Box,
    ProposalCardHeader: Box,
    ProposalListItem: Box,
    ProposalListItemBody: Box,
    ProposalListItemIndex: ({ index }: { index: number }) => (
      <span>index:{index}</span>
    ),
    ProposalStatus: ({ variant }: { variant: string }) => (
      <span>status:{variant}</span>
    ),
  };
});

import { ProposalList } from "./proposal-list";

function proposal(id: number, state?: string): Proposal {
  return {
    proposalId: String(id),
    metadata: { title: `Proposal ${id}` },
    state,
    proposalCreated: [{ timestamp: String(id) }],
    votes: {
      for: { total: 1n * 10n ** 18n },
      against: { total: 2n * 10n ** 18n },
      abstain: { total: 3n * 10n ** 18n },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    balance: 100n,
    balanceLoading: false,
    error: null,
    loading: false,
    proposals: [],
    threshold: 50n,
    thresholdLoading: false,
  });
});
afterEach(cleanup);

describe("ProposalList", () => {
  it("shows loading, error, and filtered-empty states", () => {
    mocks.loading = true;
    const { rerender } = render(<ProposalList />);
    expect(screen.getByText("loading")).toBeTruthy();
    mocks.loading = false;
    mocks.error = new Error("failed");
    rerender(<ProposalList />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalled();
    mocks.error = null;
    mocks.proposals = [proposal(1, states.Canceled)];
    rerender(<ProposalList />);
    expect(screen.getByText("No proposals match this filter.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText("Proposal 1")).toBeTruthy();
  });

  it("shows the canceled empty message", () => {
    render(<ProposalList />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText("No proposals yet.")).toBeTruthy();
  });

  it("renders every proposal status and fallback", () => {
    mocks.proposals = [
      proposal(1),
      proposal(2, states.Pending),
      proposal(3, states.Active),
      proposal(4, states.Succeeded),
      proposal(5, states.Defeated),
      proposal(6, states.Queued),
      proposal(7, states.Executed),
      proposal(8, states.Expired),
      proposal(9, "Other"),
    ];
    render(<ProposalList />);
    for (const variant of [
      "active",
      "pending",
      "succeeded",
      "defeated",
      "queued",
      "executed",
      "default",
    ]) {
      expect(screen.getAllByText(`status:${variant}`).length).toBeGreaterThan(
        0,
      );
    }
    expect(screen.getAllByText("votes:1").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: /Create New Proposal/ }),
    ).toHaveLength(2);
  });

  it("disables proposal creation while balances load or remain low", () => {
    mocks.balanceLoading = true;
    const { rerender } = render(<ProposalList />);
    expect(
      screen.queryByRole("link", { name: /Create New Proposal/ }),
    ).toBeNull();
    mocks.balanceLoading = false;
    mocks.thresholdLoading = true;
    rerender(<ProposalList />);
    expect(
      screen.queryByRole("link", { name: /Create New Proposal/ }),
    ).toBeNull();
    mocks.thresholdLoading = false;
    mocks.balance = 1n;
    rerender(<ProposalList />);
    expect(
      screen.queryByRole("link", { name: /Create New Proposal/ }),
    ).toBeNull();
  });

  it("paginates through left, middle, and right ranges", () => {
    mocks.proposals = Array.from({ length: 100 }, (_, index) =>
      proposal(index + 1, states.Active),
    );
    render(<ProposalList />);
    expect(screen.getAllByText("...").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("link", { name: "5" }));
    expect(screen.getAllByText("...")).toHaveLength(2);
    fireEvent.click(screen.getByRole("link", { name: "10" }));
    expect(screen.getAllByText("...").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("link", { name: "next" }));
    fireEvent.click(screen.getByRole("link", { name: "previous" }));
  });
});
