// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Lock = {
  lockId: string;
  owner: { id: string };
  delegate: { id: string };
  amount: string;
  expiration: Date;
  slope: number;
  replacedBy?: string;
};
const account = "0x00000000000000000000000000000000000000aa";
const other = "0x00000000000000000000000000000000000000bb";
const mocks = vi.hoisted(() => ({
  address: "0x00000000000000000000000000000000000000aa" as string | undefined,
  amountsLoading: false,
  error: null as Error | null,
  loading: false,
  locks: [] as Lock[],
  map: new Map<
    string,
    {
      remainingMento: bigint;
      withdrawn: bigint;
      originalAmount: bigint;
      currentVeMento: bigint;
    }
  >(),
  refetch: vi.fn(),
  refetchAmount: vi.fn(),
}));

vi.mock("@/contracts", () => ({
  useLockedAmount: () => ({ refetch: mocks.refetchAmount }),
  useLocksByAccount: () => ({
    locks: mocks.locks,
    loading: mocks.loading,
    error: mocks.error,
    refetch: mocks.refetch,
  }),
}));
vi.mock("@/hooks/use-lock-amounts-from-withdrawals", () => ({
  useLockAmountsFromWithdrawals: () => ({
    lockAmountsMap: mocks.map,
    loading: mocks.amountsLoading,
  }),
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: mocks.address }),
}));
vi.mock("@repo/web3", () => ({
  Identicon: ({ address }: { address: string }) => (
    <span>identicon:{address}</span>
  ),
  useCurrentChain: () => ({
    blockExplorers: { default: { url: "https://explorer.test" } },
  }),
  WalletHelper: { getShortAddress: (address: string) => `short:${address}` },
}));
vi.mock("lucide-react", () => ({ Info: () => <span>info</span> }));
vi.mock("@mento-protocol/ui", () => {
  const Box = ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    type?: string;
    asChild?: boolean;
  }) => <div {...props}>{children}</div>;
  return {
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    CopyToClipboard: ({ text }: { text: string }) => <span>copy:{text}</span>,
    LockCard: Box,
    LockCardActions: Box,
    LockCardAmount: Box,
    LockCardBadge: Box,
    LockCardBody: Box,
    LockCardButton: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    LockCardDelegationAddress: Box,
    LockCardDelegationLabel: Box,
    LockCardField: Box,
    LockCardFieldLabel: Box,
    LockCardFieldValue: Box,
    LockCardHeader: Box,
    LockCardHeaderGroup: Box,
    LockCardNotice: Box,
    LockCardRow: Box,
    LockCardToken: Box,
    Skeleton: Box,
    Tooltip: Box,
    TooltipContent: Box,
    TooltipProvider: Box,
    TooltipTrigger: Box,
  };
});
vi.mock("./update-lock-dialog", () => ({
  UpdateLockDialog: ({
    lock,
    onLockUpdated,
    onOpenChange,
  }: {
    lock: Lock;
    onLockUpdated: () => void;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      dialog:{lock.lockId}
      <button onClick={onLockUpdated}>updated</button>
      <button onClick={() => onOpenChange(false)}>dismiss update</button>
    </div>
  ),
}));

import { LockList } from "./lock-list";

function lock(
  id: string,
  owner: string,
  delegate: string,
  expiration: string,
  replacedBy?: string,
): Lock {
  return {
    lockId: id,
    owner: { id: owner },
    delegate: { id: delegate },
    amount: "2000000000000000000",
    expiration: new Date(expiration),
    slope: 4,
    replacedBy,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T00:00:00Z"));
  vi.clearAllMocks();
  Object.assign(mocks, {
    address: account,
    amountsLoading: false,
    error: null,
    loading: false,
    locks: [],
    map: new Map(),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LockList", () => {
  it("renders an empty state and a retryable error", () => {
    const { container, rerender } = render(<LockList />);
    expect(container.innerHTML).toBe("");
    mocks.error = new Error("failed");
    rerender(<LockList />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("renders loading skeletons", () => {
    mocks.locks = [lock("1", account, account, "2027-01-01")];
    mocks.loading = true;
    const { container, rerender } = render(<LockList />);
    expect(container.querySelectorAll(".rounded-md")).toHaveLength(4);
    mocks.loading = false;
    mocks.amountsLoading = true;
    rerender(<LockList />);
    expect(container.querySelectorAll(".rounded-md")).toHaveLength(4);
  });

  it("renders personal, delegated, and received active locks", () => {
    mocks.locks = [
      lock("1", account, account, "2027-01-01"),
      lock("2", account, other, "2027-02-01"),
      lock("3", other, account, "2027-03-01"),
      lock("4", account, account, "2027-04-01", "replacement"),
    ];
    mocks.map = new Map([
      [
        "1",
        {
          remainingMento: 1n * 10n ** 18n,
          withdrawn: 1n,
          originalAmount: 2n,
          currentVeMento: 3n * 10n ** 18n,
        },
      ],
      [
        "3",
        {
          remainingMento: 1n,
          withdrawn: 0n,
          originalAmount: 1n,
          currentVeMento: 4n * 10n ** 18n,
        },
      ],
    ]);
    render(<LockList />);
    expect(screen.getByText("Personal")).toBeTruthy();
    expect(screen.getByText("Delegated")).toBeTruthy();
    expect(screen.getByText("Received")).toBeTruthy();
    expect(screen.getAllByText("Current veMENTO")).toHaveLength(2);
    expect(screen.getByText("Only the", { exact: false })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Update" })).toHaveLength(2);
  });

  it("opens an update dialog and refreshes after completion", () => {
    mocks.locks = [lock("1", account, account, "2027-01-01")];
    render(<LockList />);
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(screen.getByText("dialog:1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "dismiss update" }));
    fireEvent.click(screen.getByRole("button", { name: "updated" }));
    expect(mocks.refetch).toHaveBeenCalled();
    expect(mocks.refetchAmount).toHaveBeenCalled();
  });

  it("renders expired owned and delegated locks", () => {
    mocks.locks = [
      lock("1", account, account, "2025-01-01"),
      lock("2", account, other, "2025-02-01"),
      lock("3", other, account, "2025-03-01"),
    ];
    render(<LockList />);
    expect(screen.getByText("Your Past Locks")).toBeTruthy();
    expect(screen.getAllByText("Expired").length).toBeGreaterThan(0);
    expect(screen.getByText("Delegated to")).toBeTruthy();
    expect(screen.getByText("Received from")).toBeTruthy();
  });
});
