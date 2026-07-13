import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mento-protocol/ui", () => ({
  cn: (...classes: unknown[]) =>
    classes.filter((value) => typeof value === "string" && value).join(" "),
  Logo: () => <span>Logo</span>,
  NavigationMenu: ({ children }: { children: React.ReactNode }) => (
    <nav>{children}</nav>
  ),
  NavigationMenuItem: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  NavigationMenuLink: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  NavigationMenuList: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@repo/web3", () => ({
  Celo: {},
  CeloSepolia: {},
  ChainButton: () => <span>Chain</span>,
  ConnectButton: () => <span>Connect</span>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { Header } from "./header";

describe("Header external links", () => {
  afterEach(() => {
    cleanup();
  });

  it("links the Governance Forum item to the Mento forum", () => {
    render(<Header />);

    expect(
      (
        screen.getByRole("link", {
          name: "Governance Forum",
        }) as HTMLAnchorElement | null
      )?.href,
    ).toBe("https://forum.mento.org/");
  });
});
