import { describe, expect, it } from "vitest";
import { getActiveGovernanceTransactionError } from "./get-active-governance-transaction-error";

describe("getActiveGovernanceTransactionError", () => {
  it("returns the first displayable transaction error", () => {
    expect(
      getActiveGovernanceTransactionError([
        { kind: "execute", error: null },
        {
          kind: "queue",
          error: new Error("insufficient funds for gas * price + value"),
        },
      ]),
    ).toEqual({
      label: "Error queueing proposal",
      message: "Insufficient funds for this transaction.",
    });
  });

  it("suppresses lower-priority errors after a higher-priority user rejection", () => {
    expect(
      getActiveGovernanceTransactionError([
        {
          kind: "execute",
          error: new Error("Transaction rejected by user"),
        },
        { kind: "queue", error: new Error("execution reverted") },
      ]),
    ).toBeNull();
  });

  it("returns null when only user rejections are present", () => {
    expect(
      getActiveGovernanceTransactionError([
        {
          kind: "execute",
          error: new Error("MetaMask Tx Signature: User rejected the request."),
        },
      ]),
    ).toBeNull();
  });
});
