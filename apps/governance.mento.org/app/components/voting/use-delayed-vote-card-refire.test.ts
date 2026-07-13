import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDelayedVoteCardRefire } from "./use-delayed-vote-card-refire";

describe("useDelayedVoteCardRefire", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("refires vote receipt and vote confirmation after vote confirmation", () => {
    const refetchVoteReceipt = vi.fn();
    const onVoteConfirmed = vi.fn();

    renderHook(() =>
      useDelayedVoteCardRefire({
        isVoteConfirmed: true,
        isQueueConfirmed: false,
        isProposerCancelConfirmed: false,
        refetchVoteReceipt,
        onVoteConfirmed,
      }),
    );

    expect(refetchVoteReceipt).toHaveBeenCalledTimes(1);
    expect(onVoteConfirmed).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    expect(refetchVoteReceipt).toHaveBeenCalledTimes(2);
    expect(onVoteConfirmed).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(3000);
    expect(refetchVoteReceipt).toHaveBeenCalledTimes(3);
    expect(onVoteConfirmed).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      name: "queue confirmation",
      isQueueConfirmed: true,
      isProposerCancelConfirmed: false,
    },
    {
      name: "proposer cancel confirmation",
      isQueueConfirmed: false,
      isProposerCancelConfirmed: true,
    },
  ])(
    "refires vote confirmation after $name without refetching the vote receipt",
    ({ isQueueConfirmed, isProposerCancelConfirmed }) => {
      const refetchVoteReceipt = vi.fn();
      const onVoteConfirmed = vi.fn();

      renderHook(() =>
        useDelayedVoteCardRefire({
          isVoteConfirmed: false,
          isQueueConfirmed,
          isProposerCancelConfirmed,
          refetchVoteReceipt,
          onVoteConfirmed,
        }),
      );

      expect(refetchVoteReceipt).not.toHaveBeenCalled();
      expect(onVoteConfirmed).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2000);
      expect(onVoteConfirmed).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(3000);
      expect(onVoteConfirmed).toHaveBeenCalledTimes(3);
      expect(refetchVoteReceipt).not.toHaveBeenCalled();
    },
  );

  it("cleans up pending delayed refires on unmount", () => {
    const refetchVoteReceipt = vi.fn();
    const onVoteConfirmed = vi.fn();

    const { unmount } = renderHook(() =>
      useDelayedVoteCardRefire({
        isVoteConfirmed: true,
        isQueueConfirmed: false,
        isProposerCancelConfirmed: false,
        refetchVoteReceipt,
        onVoteConfirmed,
      }),
    );

    expect(refetchVoteReceipt).toHaveBeenCalledTimes(1);
    expect(onVoteConfirmed).toHaveBeenCalledTimes(1);

    unmount();
    vi.advanceTimersByTime(5000);

    expect(refetchVoteReceipt).toHaveBeenCalledTimes(1);
    expect(onVoteConfirmed).toHaveBeenCalledTimes(1);
  });
});
