// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  block: undefined as bigint | undefined,
  chainId: undefined as number | undefined,
  currentWeek: undefined as bigint | undefined,
  locks: undefined as undefined | Array<{ owner?: { id?: string } }>,
  proposals: [] as Array<{ endBlock: bigint }>,
  supply: undefined as bigint | undefined,
}));
vi.mock("@mento-protocol/ui", () => ({
  IconInfo: () => <span>info</span>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@repo/web3", () => ({
  ensureChainId: (id?: number) => id ?? 42220,
  NumbersService: { parseNumericValue: (value: number) => `total:${value}` },
  useTokens: () => ({ veMentoContractData: { totalSupply: mocks.supply } }),
}));
vi.mock("@/contracts/locking", () => ({
  useAllLocks: () => ({ locks: mocks.locks }),
  useLockingWeek: () => ({ currentWeek: mocks.currentWeek }),
}));
vi.mock("@/contracts/governor", () => ({
  useProposals: () => ({ proposals: mocks.proposals }),
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ chainId: mocks.chainId }),
  useBlockNumber: () => ({ data: mocks.block }),
}));

import { ProposalStats } from "./proposal-stats";

beforeEach(() => {
  Object.assign(mocks, {
    block: undefined,
    chainId: undefined,
    currentWeek: undefined,
    locks: undefined,
    proposals: [],
    supply: undefined,
  });
});
afterEach(cleanup);

describe("ProposalStats", () => {
  it("renders zero-value fallbacks", () => {
    render(<ProposalStats />);
    expect(screen.getByText("total:0")).toBeTruthy();
    expect(screen.getAllByText("0").length).toBeGreaterThan(1);
  });

  it("counts proposals and unique voters", () => {
    Object.assign(mocks, {
      block: 10n,
      chainId: 42220,
      currentWeek: 1n,
      supply: 5n * 10n ** 18n,
      proposals: [{ endBlock: 5n }, { endBlock: 20n }],
      locks: [
        { owner: { id: "0xa" } },
        { owner: { id: "0xa" } },
        { owner: { id: "0xb" } },
        {},
        { owner: {} },
      ],
    });
    render(<ProposalStats />);
    expect(screen.getByText("total:5")).toBeTruthy();
    expect(screen.getAllByText("2").length).toBeGreaterThan(1);
    expect(screen.getByText("1")).toBeTruthy();
  });
});
