import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpportunityCard,
  type LpOpportunity,
  type StabilityOpportunity,
} from "./opportunity-card";

vi.mock("next/image", () => ({
  default: (
    props: React.ImgHTMLAttributes<HTMLImageElement> & { src: string },
  ) => {
    const imageProps = { ...props };
    delete imageProps.unoptimized;

    // eslint-disable-next-line @next/next/no-img-element
    return <img {...imageProps} />;
  },
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          event.preventDefault();
          window.history.pushState({}, "", href);
        }
      }}
      {...rest}
    >
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
  beforeEach(() => {
    window.history.replaceState({}, "", "/earn");
  });

  afterEach(() => {
    cleanup();
  });

  it("navigates to the stability opportunity when the CTA is clicked", () => {
    render(<OpportunityCard opp={stabilityOpportunity} />);

    const link = screen.getByTestId("earn-opportunity-cta");
    expect(link.getAttribute("href")).toBe(
      "/earn/stability/celo/gbpm?source=earn",
    );

    fireEvent.click(link);

    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/earn/stability/celo/gbpm?source=earn",
    );
  });

  it("navigates to the LP opportunity when the CTA is clicked", () => {
    render(<OpportunityCard opp={lpOpportunity} />);

    const link = screen.getByTestId("earn-opportunity-cta");
    expect(link.getAttribute("href")).toBe("/pools/celo/0xpool?source=earn");

    fireEvent.click(link);

    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/pools/celo/0xpool?source=earn",
    );
  });
});
