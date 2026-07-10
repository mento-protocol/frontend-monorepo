import { describe, expect, it } from "vitest";
import { getGovernanceTransactionErrorMessage } from "./get-governance-transaction-error-message";

describe("getGovernanceTransactionErrorMessage", () => {
  it("returns null for user rejection variants", () => {
    expect(
      getGovernanceTransactionErrorMessage(
        new Error("MetaMask Tx Signature: User rejected the request."),
      ),
    ).toBeNull();
    expect(
      getGovernanceTransactionErrorMessage(
        new Error("User denied transaction signature"),
      ),
    ).toBeNull();
    expect(
      getGovernanceTransactionErrorMessage(new Error("request rejected")),
    ).toBeNull();
    expect(
      getGovernanceTransactionErrorMessage(new Error("User denied")),
    ).toBeNull();
    expect(getGovernanceTransactionErrorMessage({ code: 4001 })).toBeNull();
  });

  it("returns insufficient funds copy", () => {
    expect(
      getGovernanceTransactionErrorMessage(
        new Error("insufficient funds for gas * price + value"),
      ),
    ).toBe("Insufficient funds for this transaction.");
  });

  it("reads viem details from Error instances", () => {
    const error = new Error("Transaction failed") as Error & {
      details: string;
    };
    error.details = "insufficient funds for gas * price + value";

    expect(getGovernanceTransactionErrorMessage(error)).toBe(
      "Insufficient funds for this transaction.",
    );
  });

  it("returns the generic fallback for unknown errors", () => {
    expect(
      getGovernanceTransactionErrorMessage(new Error("execution reverted")),
    ).toBe("Something went wrong. Please try again.");
  });
});
