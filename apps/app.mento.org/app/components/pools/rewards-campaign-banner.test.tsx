// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lucide-react", () => ({
  ExternalLink: () => <span>external</span>,
  Star: () => <span>star</span>,
  X: () => <span>x</span>,
}));
vi.mock("@mento-protocol/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@repo/web3", () => ({
  getPoolRewardKey: (chainId: number, address: string) =>
    `${chainId}:${address}`,
}));

import { RewardsCampaignBanner } from "./rewards-campaign-banner";

const pools = [
  { chainId: 42220, poolAddr: "0x1" },
  { chainId: 42220, poolAddr: "0x2" },
  { chainId: 42220, poolAddr: "0x3" },
] as never;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RewardsCampaignBanner", () => {
  it("renders campaign totals, advances its tracer, and dismisses", () => {
    const end = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
    const rewards = new Map([
      ["42220:0x1", { apr: 5, campaignEnd: end }],
      ["42220:0x2", { apr: 8.5, campaignEnd: end + 100 }],
    ]) as never;
    const { container } = render(
      <RewardsCampaignBanner rewards={rewards} pools={pools} />,
    );
    expect(screen.getByText("8.5% APR")).toBeTruthy();
    expect(screen.getByText(/2 eligible pools/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(50));
    expect(container.querySelector("[style]")?.getAttribute("style")).toContain(
      "3.6deg",
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(container.innerHTML).toBe("");
  });

  it("uses singular grammar and hides an empty campaign", () => {
    const rewards = new Map([
      ["42220:0x1", { apr: 3, campaignEnd: 0 }],
    ]) as never;
    const { rerender, container } = render(
      <RewardsCampaignBanner rewards={rewards} pools={pools} />,
    );
    expect(screen.getByText(/1 eligible pool/)).toBeTruthy();
    rerender(<RewardsCampaignBanner rewards={new Map()} pools={pools} />);
    expect(container.innerHTML).toBe("");
  });
});
