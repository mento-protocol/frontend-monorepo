import { describe, expect, it } from "vitest";
import { normalizeTxError } from "./send-tx";

describe("normalizeTxError", () => {
  it.each([
    ["execution reverted: DebtBelowMin", "Debt is below protocol minimum"],
    [
      "execution reverted with reason string 'InterestRateTooHigh'",
      "Interest rate is above the allowed maximum",
    ],
    ["execution reverted\nreason: ICRBelowMCR", "Collateral ratio is too low"],
    [
      "execution reverted\nThe contract function reverted with the following reason:\nDebtBelowMin",
      "Debt is below protocol minimum",
    ],
  ])("extracts a revert reason from %s", (message, expectedReason) => {
    expect(normalizeTxError(new Error(message)).message).toContain(
      expectedReason,
    );
  });

  it("handles an uncontrolled reason string with extensive whitespace", () => {
    const message = `execution reverted\nreason:${" ".repeat(100_000)}DebtBelowMin`;

    expect(normalizeTxError(new Error(message)).message).toBe(
      "Transaction reverted: Debt is below protocol minimum",
    );
  });
});
