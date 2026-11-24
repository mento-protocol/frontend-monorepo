// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  atomTab: "pool",
  pathname: "/",
  setTheme: vi.fn(),
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
vi.mock("@repo/web3", () => ({
  ChainButton: () => <span>chain</span>,
  ConnectButton: ({ text }: { text?: string }) => (
    <span>{text ?? "Connect wallet"}</span>
  ),
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
  ArrowUpRight: () => <span>arrow</span>,
  Moon: () => <span>moon</span>,
  Sun: () => <span>sun</span>,
}));

import { Header } from "./header";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    atomTab: "pool",
    pathname: "/",
    theme: "light",
  });
});
afterEach(cleanup);

describe("Header", () => {
  it("builds all navigation links and toggles the theme", () => {
    render(<Header />);
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

  it("links Swap to Squid in a new tab, after the in-app tabs", () => {
    render(<Header />);
    const links = screen
      .getAllByRole("link")
      .filter((link) => link.closest("nav"));
    expect(links.map((link) => link.textContent)).toEqual([
      "Pool",
      "Borrow",
      "Earn",
      "Bridge",
      "Swaparrow(opens Squid in a new tab)",
    ]);
    const swap = screen.getByRole("link", { name: /Swap/ });
    expect(swap.getAttribute("href")).toBe("https://app.squidrouter.com/");
    expect(swap.getAttribute("target")).toBe("_blank");
    expect(swap.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it.each(["/pools", "/borrow", "/earn", "/bridge"])(
    "derives the active tab from %s",
    (pathname) => {
      mocks.pathname = pathname;
      const { container } = render(<Header />);
      const activeLink = container.querySelector("a.text-foreground");
      expect(activeLink).toBeTruthy();
      window.dispatchEvent(new Event("resize"));
    },
  );

  it("falls back to the stored tab on unrouted paths", () => {
    mocks.pathname = "/other";
    mocks.atomTab = "borrow";
    render(<Header />);
    expect(screen.getByRole("link", { name: "Borrow" }).className).toContain(
      "text-foreground",
    );
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
