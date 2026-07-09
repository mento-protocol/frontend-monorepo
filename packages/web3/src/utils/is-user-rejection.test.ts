import { UserRejectedRequestError } from "viem";
import { describe, expect, it } from "vitest";
import { isUserRejection } from "./is-user-rejection";

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
  });

  it("detects WalletConnect rejection messages", () => {
    expect(isUserRejection("Request rejected")).toBe(true);
  });

  it("detects a UserRejectedRequestError instance via BaseError#walk", () => {
    const error = new UserRejectedRequestError(new Error("denied"));
    expect(isUserRejection(error)).toBe(true);
  });

  it("detects an EIP-1193 code 4001 error object", () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
  });

  it("does not misclassify unrelated errors", () => {
    expect(isUserRejection("insufficient funds")).toBe(false);
    expect(isUserRejection("execution reverted")).toBe(false);
    expect(isUserRejection(undefined)).toBe(false);
  });
});
