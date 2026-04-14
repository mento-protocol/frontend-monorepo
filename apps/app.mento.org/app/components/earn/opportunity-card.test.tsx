import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpportunityCard,
  type LpOpportunity,
  type StabilityOpportunity,
} from "./opportunity-card";

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    unoptimized: _unoptimized,
    ...rest
  }: React.ImgHTMLAttributes<HTMLImageElement> & { src: string }) => (
    <img alt={alt} src={src} {...rest} />
  ),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@repo/ui", () => ({
  Card: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...rest}>{children}</div>
  ),
  CardContent: ({
    children,
    ...rest
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...rest}>{children}</div>,
  TokenIcon: () => <div data-testid="token-icon" />,
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

vi.mock("@repo/web3", () => ({
  chainIdToChain: {
    42220: {
      name: "Celo",
      iconUrl: "/celo.png",
    },
  },
}));

const baseOpportunity = {
  chainId: 42220,
  apy: 12.34,
  apyLabel: "Pool APY",
  hasRewards: false,
  earnMechanics: [{ label: "Protocol yield", color: "indigo" as const }],
  stats: [{ label: "Lock-up", value: "None" }],
  userPosition: null,
};

const stabilityOpportunity: StabilityOpportunity = {
  ...baseOpportunity,
  id: "sp-celo-gbpm",
  type: "stability",
  name: "GBPm Stability Pool",
  token: { address: "0x1", symbol: "GBPm" },
  href: "/earn/stability/celo/gbpm?source=earn",
};

const lpOpportunity: LpOpportunity = {
  ...baseOpportunity,
  id: "lp-celo-0xpool",
  type: "lp",
  name: "CELO / cUSD",
  apyLabel: "Total APR",
  tokenA: { address: "0x2", symbol: "CELO" },
  tokenB: { address: "0x3", symbol: "cUSD" },
  href: "/pools/celo/0xpool?source=earn",
};

describe("OpportunityCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a stability CTA with a non-empty href and source=earn", () => {
    render(<OpportunityCard opp={stabilityOpportunity} />);

    const link = screen.getByTestId("earn-opportunity-cta");
    expect(link.getAttribute("href")).toBe(
      "/earn/stability/celo/gbpm?source=earn",
    );
    expect(link.getAttribute("href")).toContain("source=earn");
    expect(link.textContent).toContain("Start Earning");
  });

  it("renders an LP CTA with a non-empty href and source=earn", () => {
    render(<OpportunityCard opp={lpOpportunity} />);

    const link = screen.getByTestId("earn-opportunity-cta");
    expect(link.getAttribute("href")).toBe("/pools/celo/0xpool?source=earn");
    expect(link.getAttribute("href")).toContain("source=earn");
    expect(link.textContent).toContain("Start Earning");
  });
});
