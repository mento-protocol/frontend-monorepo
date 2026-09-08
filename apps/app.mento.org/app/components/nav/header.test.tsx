// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  atomTab: "swap",
  chainId: 42220,
  pathname: "/",
  setTheme: vi.fn(),
  testnetMode: false,
  theme: "light",
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: mocks.theme, setTheme: mocks.setTheme }),
}));
vi.mock("jotai", () => ({ useAtomValue: () => mocks.atomTab }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
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
vi.mock("@/atoms/navigation", () => ({ activeTabAtom: {} }));
vi.mock("@repo/web3/wagmi", () => ({ useChainId: () => mocks.chainId }));
vi.mock("@repo/web3", () => ({
  ChainButton: () => <span>chain</span>,
  ChainId: { Celo: 42220 },
  ConnectButton: ({ text }: { text?: string }) => (
    <span>{text ?? "Connect wallet"}</span>
  ),
  chainIdToSlug: (chainId: number) => (chainId === 42220 ? "celo" : undefined),
  getPreferredVisibleChain: () => mocks.chainId,
  useTestnetMode: () => [mocks.testnetMode],
}));
vi.mock("@mento-protocol/ui", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Logo: () => <span>logo</span>,
  cn: (...classes: Array<string | false | undefined>) =>
    classes.filter(Boolean).join(" "),
}));
vi.mock("lucide-react", () => ({
  Moon: () => <span>moon</span>,
  Sun: () => <span>sun</span>,
}));

import { Header } from "./header";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    atomTab: "swap",
    chainId: 42220,
    pathname: "/",
    testnetMode: false,
    theme: "light",
  });
});
afterEach(cleanup);

describe("Header", () => {
  it("builds all navigation links and toggles the theme", () => {
    render(<Header />);
    expect(
      screen.getByRole("link", { name: "Swap" }).getAttribute("href"),
    ).toBe("/swap/celo");
    expect(
      screen.getByRole("link", { name: "Pool" }).getAttribute("href"),
    ).toBe("/pools");
    expect(
      screen.getByRole("link", { name: "Borrow" }).getAttribute("href"),
    ).toBe("/borrow");
    expect(
      screen.getByRole("link", { name: "Earn" }).getAttribute("href"),
    ).toBe("/earn");
    expect(
      screen.getByRole("link", { name: "Bridge" }).getAttribute("href"),
    ).toBe("/bridge");
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to dark theme" }),
    );
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
  });

  it.each(["/pools", "/swap/celo", "/borrow", "/earn", "/bridge"])(
    "derives the active tab from %s",
    (pathname) => {
      mocks.pathname = pathname;
      const { container } = render(<Header />);
      const activeLink = container.querySelector("a.text-foreground");
      expect(activeLink).toBeTruthy();
      window.dispatchEvent(new Event("resize"));
    },
  );

  it("uses the atom fallback and a fallback swap slug", () => {
    mocks.pathname = "/other";
    mocks.atomTab = "pool";
    mocks.chainId = 999;
    render(<Header />);
    expect(
      screen.getByRole("link", { name: "Swap" }).getAttribute("href"),
    ).toBe("/swap/celo");
  });

  it("switches a dark theme to light", () => {
    mocks.theme = "dark";
    render(<Header />);
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to light theme" }),
    );
    expect(mocks.setTheme).toHaveBeenCalledWith("light");
  });
});
