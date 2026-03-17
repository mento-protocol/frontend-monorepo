import { describe, expect, it } from "vitest";
import {
  SWAP_ERROR_MESSAGES,
  getToastErrorMessage,
  shouldRetrySwapError,
} from "./error-handlers";

describe("getToastErrorMessage", () => {
  describe("overflow x1y1", () => {
    it("returns 'Amount in is too large' for overflow x1y1 error", () => {
      const result = getToastErrorMessage(SWAP_ERROR_MESSAGES.OVERFLOW_X1Y1);
      expect(result).toBe("Amount in is too large");
    });

    it("matches substring in longer error message", () => {
      const result = getToastErrorMessage(
        `Contract revert: ${SWAP_ERROR_MESSAGES.OVERFLOW_X1Y1}`,
      );
      expect(result).toBe("Amount in is too large");
    });
  });

  describe("fixidity too large", () => {
    it("returns 'Amount out is too large' for fixidity error", () => {
      const result = getToastErrorMessage(
        `${SWAP_ERROR_MESSAGES.FIXIDITY_TOO_LARGE} 123`,
      );
      expect(result).toBe("Amount out is too large");
    });
  });

  describe("no valid median / trading suspended", () => {
    it("returns paused message with token symbols for no valid median", () => {
      const result = getToastErrorMessage(SWAP_ERROR_MESSAGES.NO_VALID_MEDIAN, {
        fromTokenSymbol: "cUSD",
        toTokenSymbol: "CELO",
      });
      expect(typeof result).toBe("string");
      expect(result as string).toContain("cUSD");
      expect(result as string).toContain("CELO");
      expect(result as string).toContain("temporarily paused");
    });

    it("returns paused message for trading suspended reference rate", () => {
      const result = getToastErrorMessage(
        SWAP_ERROR_MESSAGES.TRADING_SUSPENDED_REFERENCE_RATE,
        { fromTokenSymbol: "cEUR", toTokenSymbol: "cUSD" },
      );
      expect(typeof result).toBe("string");
      expect(result as string).toContain("cEUR");
      expect(result as string).toContain("cUSD");
    });
  });

  describe("insufficient reserve balance", () => {
    it("returns plain string message when no chainId/toTokenSymbol", () => {
      const result = getToastErrorMessage(
        SWAP_ERROR_MESSAGES.INSUFFICIENT_RESERVE_BALANCE,
      );
      expect(typeof result).toBe("string");
      expect(result as string).toContain("Reserve");
      expect(result as string).toContain("smaller amount");
    });

    it("returns a function (JSX factory) when toTokenSymbol and chainId are provided", () => {
      const result = getToastErrorMessage(
        SWAP_ERROR_MESSAGES.INSUFFICIENT_RESERVE_BALANCE,
        { toTokenSymbol: "cUSD", chainId: 42220 },
      );
      expect(typeof result).toBe("function");
    });
  });

  describe("fallback", () => {
    it("returns fallback message for unknown errors", () => {
      const result = getToastErrorMessage("some completely unknown error");
      expect(result).toBe("Unable to fetch swap amount");
    });

    it("handles non-string input via String() coercion", () => {
      // The function guards via typeof check internally
      const result = getToastErrorMessage(
        String({ message: "weird object" }),
      );
      expect(result).toBe("Unable to fetch swap amount");
    });
  });
});

describe("shouldRetrySwapError", () => {
  describe("non-retryable error types", () => {
    it("does not retry trading suspended errors", () => {
      const error = new Error(SWAP_ERROR_MESSAGES.TRADING_SUSPENDED);
      expect(shouldRetrySwapError(0, error)).toBe(false);
    });

    it("does not retry overflow x1y1 errors", () => {
      const error = new Error(SWAP_ERROR_MESSAGES.OVERFLOW_X1Y1);
      expect(shouldRetrySwapError(0, error)).toBe(false);
    });

    it("does not retry fixidity too large errors", () => {
      const error = new Error(
        `${SWAP_ERROR_MESSAGES.FIXIDITY_TOO_LARGE} 12345`,
      );
      expect(shouldRetrySwapError(0, error)).toBe(false);
    });

    it("does not retry insufficient reserve balance errors", () => {
      const error = new Error(SWAP_ERROR_MESSAGES.INSUFFICIENT_RESERVE_BALANCE);
      expect(shouldRetrySwapError(0, error)).toBe(false);
    });
  });

  describe("retryable errors", () => {
    it("retries generic network errors up to 2 times (failureCount=0)", () => {
      const error = new Error("Network timeout");
      expect(shouldRetrySwapError(0, error)).toBe(true);
    });

    it("retries on failureCount=1", () => {
      const error = new Error("Network timeout");
      expect(shouldRetrySwapError(1, error)).toBe(true);
    });

    it("stops retrying at failureCount=2", () => {
      const error = new Error("Network timeout");
      expect(shouldRetrySwapError(2, error)).toBe(false);
    });

    it("stops retrying at failureCount > 2", () => {
      const error = new Error("Network timeout");
      expect(shouldRetrySwapError(5, error)).toBe(false);
    });
  });

  describe("non-Error inputs", () => {
    it("handles string errors — retries unknown strings", () => {
      expect(shouldRetrySwapError(0, "some rpc error")).toBe(true);
    });

    it("handles string with trading suspended — does not retry", () => {
      expect(
        shouldRetrySwapError(0, SWAP_ERROR_MESSAGES.TRADING_SUSPENDED),
      ).toBe(false);
    });
  });
});
