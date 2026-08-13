import { UserRejectedRequestError } from "viem";
import { describe, expect, it } from "vitest";
import {
  isStructuredUserRejection,
  isUserRejection,
  isUserRejectionForTelemetry,
} from "./is-user-rejection";

describe("isUserRejection", () => {
  it("detects MetaMask/viem rejection messages", () => {
    expect(isUserRejection("User rejected the request.")).toBe(true);
  });

  it("detects MetaMask transaction-signature denial messages", () => {
    expect(
      isUserRejection(
        "MetaMask Tx Signature: User denied transaction signature.",
      ),
    ).toBe(true);
    expect(isUserRejection("User denied")).toBe(true);
    expect(isUserRejection("denied transaction signature by user")).toBe(true);
  });

  it("detects WalletConnect rejection messages", () => {
    expect(isUserRejection("Request rejected")).toBe(true);
  });

  it("detects rejected-by-user transaction messages", () => {
    expect(isUserRejection("Transaction rejected by user")).toBe(true);
    expect(isUserRejection("Swap transaction rejected by user.")).toBe(true);
  });

  it("detects a UserRejectedRequestError instance", () => {
    const error = new UserRejectedRequestError(new Error("denied"));
    expect(isUserRejection(error)).toBe(true);
  });

  it("detects an EIP-1193 code 4001 error object", () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
  });

  it("does not misclassify unrelated errors", () => {
    expect(isUserRejection("access denied")).toBe(false);
    expect(isUserRejection("contract rejected the call")).toBe(false);
    expect(isUserRejection("insufficient funds")).toBe(false);
    expect(isUserRejection("execution reverted")).toBe(false);
    expect(isUserRejection(undefined)).toBe(false);
  });
});

describe("isUserRejectionForTelemetry", () => {
  it("accepts structured and unambiguous user denials", () => {
    expect(isUserRejectionForTelemetry({ code: 4001 })).toBe(true);
    expect(isUserRejectionForTelemetry(new Error("User denied"))).toBe(true);
    expect(
      isUserRejectionForTelemetry(new Error("Transaction rejected by user")),
    ).toBe(true);
  });

  it("keeps generic request-rejected failures reportable", () => {
    expect(
      isUserRejectionForTelemetry(new Error("Request rejected by upstream")),
    ).toBe(false);
  });

  it("finds structured causes and tolerates cause cycles", () => {
    const rejection = { code: 4001 } as { cause?: unknown; code: number };
    const wrapper = { cause: rejection };
    rejection.cause = wrapper;

    expect(isStructuredUserRejection(wrapper)).toBe(true);
    expect(isUserRejectionForTelemetry(wrapper)).toBe(true);
  });
});
