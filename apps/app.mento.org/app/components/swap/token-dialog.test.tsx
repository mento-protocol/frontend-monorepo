import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mento-protocol/ui", () => ({
  cn: (...classes: unknown[]) =>
    classes.filter((value) => typeof value === "string" && value).join(" "),
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogClose: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  IconLoading: () => <span>Loading</span>,
  Input: React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
    function MockInput(props, ref) {
      return <input ref={ref} {...props} />;
    },
  ),
  ScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TokenIcon: ({ token }: { token: { symbol: string } }) => (
    <span>{token.symbol}</span>
  ),
}));

vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: undefined }),
  useChainId: () => 42220,
}));

vi.mock("@repo/web3", () => ({
  formatBalance: () => "0",
  formatWithMaxDecimals: (value: string) => value,
  useAccountBalances: () => ({ data: undefined }),
  useTokenOptions: () => ({
    tokenOptions: [],
    allTokenOptions: [
      {
        address: "0xusd",
        symbol: "USDm",
        name: "Mento Dollar",
        decimals: 18,
      },
      {
        address: "0xeuro",
        symbol: "EURm",
        name: "Mento Euro",
        decimals: 18,
      },
    ],
  }),
  useTradablePairs: () => ({
    data: ["USDm"],
    isLoading: false,
  }),
}));

import TokenDialog from "./token-dialog";

describe("TokenDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders token choices as semantic buttons and disables unavailable pairs", () => {
    const handleValueChange = vi.fn();

    render(
      <TokenDialog
        value="USDm"
        onValueChange={handleValueChange}
        trigger={<button type="button">Select token</button>}
        filterByTokenSymbol={"GBPm" as TokenSymbol}
      />,
    );

    const availableToken = screen.getByRole("button", {
      name: /USDm Mento Dollar/,
    });
    const unavailableToken = screen.getByRole("button", {
      name: /EURm Mento Euro/,
    });

    expect((availableToken as HTMLButtonElement).disabled).toBe(false);
    expect((unavailableToken as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(unavailableToken);
    expect(handleValueChange).not.toHaveBeenCalled();

    fireEvent.click(availableToken);
    expect(handleValueChange).toHaveBeenCalledWith("USDm");
  });
});
