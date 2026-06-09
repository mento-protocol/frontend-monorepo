import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { InterestRateInput } from "./interest-rate-input";

const GBPm = {
  symbol: "GBPm",
  currencySymbol: "£",
  currencyCode: "GBP",
  locale: "en-GB",
  collateralSymbol: "USDm",
};

vi.mock("@repo/web3", () => ({
  formatDebtAmount: (amount: bigint) => amount.toString(),
  useSystemParams: () => ({
    data: { minAnnualInterestRate: 50_000_000_000_000_000n },
  }),
}));

describe("InterestRateInput", () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    global.ResizeObserver = ResizeObserverMock;
  });

  it("labels the slider control", () => {
    render(
      <InterestRateInput
        debtToken={GBPm}
        value="3.5"
        onChange={() => {}}
        debtAmount={1_000_000_000_000_000_000n}
        maxRatePct={100}
      />,
    );

    expect(
      screen.getByRole("slider", { name: "Annual interest rate" }),
    ).toBeTruthy();
  });
});
