import { describe, expect, it } from "vitest";
import {
  SWAP_ERROR_MESSAGES,
  USER_ERROR_MESSAGES,
} from "@/features/swap/error-handlers";
import { getSwapTransactionErrorMessage } from "./use-swap-transaction";

describe("getSwapTransactionErrorMessage", () => {
  const testCases: Array<{
    name: string;
    input: Error | string;
    expected: string;
  }> = [
    // Trading suspended errors
    {
      name: "returns trading paused message for reference rate suspension",
      input: new Error(
        `${SWAP_ERROR_MESSAGES.TRADING_SUSPENDED_REFERENCE_RATE}: some details`,
      ),
      expected: USER_ERROR_MESSAGES.TRADING_PAUSED,
    },
    {
      name: "handles reference rate suspension in middle of message",
      input: new Error(
        `Contract call failed: ${SWAP_ERROR_MESSAGES.TRADING_SUSPENDED_REFERENCE_RATE}`,
      ),
      expected: USER_ERROR_MESSAGES.TRADING_PAUSED,
    },
    {
      name: "handles string error for trading suspended",
      input: SWAP_ERROR_MESSAGES.TRADING_SUSPENDED_REFERENCE_RATE,
      expected: USER_ERROR_MESSAGES.TRADING_PAUSED,
    },

    // User rejection errors
    {
      name: "returns rejection message for 'user rejected' error",
      input: new Error("User rejected the request"),
      expected: USER_ERROR_MESSAGES.SWAP_REJECTED_BY_USER,
    },
    {
      name: "returns rejection message for 'USER REJECTED' (case insensitive)",
      input: new Error("USER REJECTED transaction"),
      expected: USER_ERROR_MESSAGES.SWAP_REJECTED_BY_USER,
    },
    {
      name: "returns rejection message for 'denied transaction signature'",
      input: new Error("denied transaction signature by user"),
      expected: USER_ERROR_MESSAGES.SWAP_REJECTED_BY_USER,
    },
    {
      name: "returns rejection message for 'request rejected'",
      input: new Error("request rejected"),
      expected: USER_ERROR_MESSAGES.SWAP_REJECTED_BY_USER,
    },
    {
      name: "handles string error for user rejection",
      input: "user rejected",
      expected: USER_ERROR_MESSAGES.SWAP_REJECTED_BY_USER,
    },
    {
      name: "user rejected patterns are matched via regex with extra whitespace",
      input: new Error("User  rejected transaction"),
      expected: USER_ERROR_MESSAGES.SWAP_REJECTED_BY_USER,
    },

    // Insufficient funds errors
    {
      name: "returns insufficient funds message",
      input: new Error("insufficient funds for gas * price + value"),
      expected: USER_ERROR_MESSAGES.INSUFFICIENT_FUNDS,
    },
    {
      name: "handles string error for insufficient funds",
      input: "insufficient funds",
      expected: USER_ERROR_MESSAGES.INSUFFICIENT_FUNDS,
    },
    // Transaction failed errors
    {
      name: "returns transaction failed message",
      input: new Error("Transaction failed on-chain"),
      expected: USER_ERROR_MESSAGES.TRANSACTION_FAILED,
    },

    // Unknown/fallback errors
    {
      name: "returns generic message for unhandled errors",
      input: new Error("Some unknown error occurred"),
      expected: USER_ERROR_MESSAGES.UNKNOWN_ERROR,
    },
    {
      name: "returns generic message for empty error message",
      input: new Error(""),
      expected: USER_ERROR_MESSAGES.UNKNOWN_ERROR,
    },
    {
      name: "handles string error for unknown error",
      input: "some random error",
      expected: USER_ERROR_MESSAGES.UNKNOWN_ERROR,
    },

    // Priority: trading suspended takes precedence
    {
      name: "matches trading suspended before other patterns",
      input: new Error(
        `${SWAP_ERROR_MESSAGES.TRADING_SUSPENDED_REFERENCE_RATE} - insufficient funds`,
      ),
      expected: USER_ERROR_MESSAGES.TRADING_PAUSED,
    },
  ];

  it.each(testCases)("$name", ({ input, expected }) => {
    const result = getSwapTransactionErrorMessage(input);
    expect(result).toBe(expected);
  });

  describe("edge cases for type safety", () => {
    const edgeCases: Array<{
      name: string;
      input: unknown;
      expected: string;
    }> = [
      {
        name: "handles Error with undefined message gracefully",
        input: new Error(),
        expected: USER_ERROR_MESSAGES.UNKNOWN_ERROR,
      },
      {
        name: "handles Error with null-ish properties via String coercion",
        input: { message: undefined, name: "Error" },
        expected: USER_ERROR_MESSAGES.UNKNOWN_ERROR,
      },
      {
        name: "handles error with array message by converting to string",
        input: { message: ["error1", "error2"], name: "Error" },
        expected: USER_ERROR_MESSAGES.UNKNOWN_ERROR,
      },
      {
        name: "handles error with object message by converting to string",
        input: { message: { code: 123, text: "error" }, name: "Error" },
        expected: USER_ERROR_MESSAGES.UNKNOWN_ERROR,
      },
      {
        name: "handles error with number message",
        input: { message: 12345, name: "Error" },
        expected: USER_ERROR_MESSAGES.UNKNOWN_ERROR,
      },
    ];

    it.each(edgeCases)("$name", ({ input, expected }) => {
      const result = getSwapTransactionErrorMessage(input as Error);
      expect(result).toBe(expected);
    });
  });
});
