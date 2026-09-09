// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0x00000000000000000000000000000000000000aa" as string | undefined,
  amount: "2" as string | undefined,
  approve: {
    approveMento: vi.fn(),
    error: null as Error | null,
    hash: undefined as string | undefined,
    isAwaitingUserSignature: false,
    isConfirmed: false,
    isConfirming: false,
    reset: vi.fn(),
  },
  delegateAddress: "0x00000000000000000000000000000000000000bb" as
    | string
    | undefined,
  delegateEnabled: false,
  lock: {
    error: null as Error | null,
    hash: undefined as string | undefined,
    isAwaitingUserSignature: false,
    isConfirmed: false,
    isConfirming: false,
    lockMento: vi.fn(),
    reset: vi.fn(),
  },
  lockConfirmation: null as null | (() => void),
  minCliff: 2n,
  minSlope: 3n,
  resetForm: vi.fn(),
  slope: 8 as number | undefined,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  unlockDate: new Date("2027-01-01T00:00:00Z") as Date | undefined,
}));

vi.mock("@/contracts", () => ({
  useApprove: () => mocks.approve,
  useLockMento: (options: { onLockConfirmation: () => void }) => {
    mocks.lockConfirmation = options.onLockConfirmation;
    return mocks.lock;
  },
}));
vi.mock("@/hooks/use-current-chain", () => ({
  useCurrentChain: () => ({
    blockExplorers: { default: { url: "https://explorer.test" } },
  }),
}));
vi.mock("@mento-protocol/ui", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock("@repo/web3", () => ({
  LockingABI: [],
  isValidAddress: (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value),
  useContracts: () => ({ Locking: { address: "0xlocking" } }),
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: mocks.address, chainId: 42220 }),
  useReadContract: ({ functionName }: { functionName: string }) => ({
    data: functionName === "minSlopePeriod" ? mocks.minSlope : mocks.minCliff,
  }),
}));
vi.mock("react-hook-form", () => ({
  useFormContext: () => ({
    watch: (key: string) =>
      ({
        amount: mocks.amount,
        unlockDate: mocks.unlockDate,
        delegateEnabled: mocks.delegateEnabled,
        delegateAddress: mocks.delegateAddress,
        duration: mocks.slope,
      })[key],
    reset: mocks.resetForm,
  }),
}));
vi.mock("../tx-dialog/tx-dialog", () => ({
  TxDialog: ({
    isOpen,
    message,
    onClose,
    retry,
    error,
  }: {
    isOpen: boolean;
    message: React.ReactNode;
    onClose: () => void;
    retry: () => void;
    error: boolean;
  }) => (
    <div
      data-testid="dialog"
      data-open={String(isOpen)}
      data-error={String(error)}
    >
      {message}
      {isOpen && (
        <>
          <button onClick={onClose}>close</button>
          <button onClick={retry}>retry</button>
        </>
      )}
    </div>
  ),
}));

import { CreateLockProvider, useCreateLock } from "./create-lock-provider";

function Consumer() {
  const context = useCreateLock();
  return (
    <div>
      <span>
        {String(context.needsApproval)}:{context.CreateLockTxStatus}:
        {context.CreateLockApprovalStatus}
      </span>
      <button onClick={context.createLock}>create</button>
      <button onClick={context.reset}>reset</button>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  vi.clearAllMocks();
  Object.assign(mocks, {
    address: "0x00000000000000000000000000000000000000aa",
    amount: "2",
    delegateAddress: "0x00000000000000000000000000000000000000bb",
    delegateEnabled: false,
    minCliff: 2n,
    minSlope: 3n,
    slope: 8,
    unlockDate: new Date("2027-01-01T00:00:00Z"),
  });
  Object.assign(mocks.approve, {
    error: null,
    hash: undefined,
    isAwaitingUserSignature: false,
    isConfirmed: false,
    isConfirming: false,
  });
  Object.assign(mocks.lock, {
    error: null,
    hash: undefined,
    isAwaitingUserSignature: false,
    isConfirmed: false,
    isConfirming: false,
  });
  mocks.approve.approveMento.mockImplementation(
    ({ onConfirmation }: { onConfirmation: () => void }) => onConfirmation(),
  );
  mocks.lock.lockMento.mockImplementation(
    ({ onSuccess }: { onSuccess: () => void }) => onSuccess(),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CreateLockProvider", () => {
  it("requires its provider", () => {
    expect(() => render(<Consumer />)).toThrow(
      "useCreateLock must be used within a CreateLockProvider",
    );
  });

  it("approves and creates a lock", () => {
    render(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    expect(screen.getByText("true:UNKNOWN:NOT_APPROVED")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    expect(mocks.approve.approveMento).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2n * 10n ** 18n, target: "0xlocking" }),
    );
    expect(mocks.lock.lockMento).toHaveBeenCalledWith(
      expect.objectContaining({
        account: mocks.address,
        cliff: 2,
        slope: 8,
        delegate: mocks.address,
      }),
    );
    expect(mocks.resetForm).toHaveBeenCalled();
  });

  it("uses a selected delegate and minimum periods", () => {
    mocks.delegateEnabled = true;
    mocks.slope = 1;
    render(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    expect(mocks.lock.lockMento).toHaveBeenCalledWith(
      expect.objectContaining({
        cliff: 2,
        slope: 3,
        delegate: mocks.delegateAddress,
      }),
    );
  });

  it("requires an unlock date and accepts zero or invalid amounts", () => {
    mocks.unlockDate = undefined;
    const { rerender } = render(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Please select a lock end date",
    );
    mocks.unlockDate = new Date("2027-01-01T00:00:00Z");
    mocks.amount = "0.5";
    rerender(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    expect(screen.getByText("false:UNKNOWN:APPROVED")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    expect(mocks.lock.lockMento).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 0n }),
    );
    mocks.amount = "bad";
    rerender(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    expect(screen.getByText("false:UNKNOWN:APPROVED")).toBeTruthy();
  });

  it("derives transaction states", () => {
    mocks.approve.isAwaitingUserSignature = true;
    const { rerender } = render(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    expect(screen.getByText(/AWAITING_SIGNATURE/)).toBeTruthy();
    expect(screen.getByText("Continue in wallet")).toBeTruthy();
    mocks.approve.isAwaitingUserSignature = false;
    mocks.approve.isConfirming = true;
    rerender(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    expect(screen.getByText(/CONFIRMING_APPROVE_TX/)).toBeTruthy();
    expect(screen.getByText("Confirming...")).toBeTruthy();
    mocks.approve.isConfirming = false;
    mocks.lock.isAwaitingUserSignature = true;
    rerender(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    expect(screen.getByText(/AWAITING_SIGNATURE/)).toBeTruthy();
    mocks.lock.isAwaitingUserSignature = false;
    mocks.lock.isConfirming = true;
    rerender(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    expect(screen.getByText(/CONFIRMING_LOCK_TX/)).toBeTruthy();
  });

  it("reports callback and hook errors", () => {
    mocks.approve.approveMento.mockImplementation(
      ({ onError }: { onError: (error: Error) => void }) =>
        onError(new Error("failed")),
    );
    const { rerender } = render(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    expect(mocks.toastError).toHaveBeenCalledWith("Failed to approve MENTO");
    expect(screen.getByText(/ERROR/)).toBeTruthy();
    mocks.approve.error = new Error("User rejected request");
    rerender(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Approval transaction rejected by user",
    );
    mocks.approve.error = new Error("rpc");
    rerender(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Approval transaction failed",
    );
    mocks.approve.error = null;
    mocks.lock.error = new Error("User rejected request");
    rerender(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Lock transaction rejected by user",
    );
    mocks.lock.error = new Error("rpc");
    rerender(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    expect(mocks.toastError).toHaveBeenCalledWith("Lock transaction failed");
  });

  it("reports confirmed approval and lock transactions", () => {
    mocks.approve.isConfirmed = true;
    mocks.approve.hash = "0xapprove";
    const { rerender } = render(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    expect(mocks.toastSuccess).toHaveBeenCalled();
    mocks.approve.isConfirmed = false;
    mocks.lock.isConfirmed = true;
    mocks.lock.hash = "0xlock";
    rerender(
      <CreateLockProvider>
        <Consumer />
      </CreateLockProvider>,
    );
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(2);
  });

  it("closes, retries, resets, and completes a dialog", () => {
    const confirmed = vi.fn();
    render(
      <CreateLockProvider onLockConfirmation={confirmed}>
        <Consumer />
      </CreateLockProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(mocks.approve.reset).toHaveBeenCalled();
    mocks.lockConfirmation?.();
    expect(confirmed).toHaveBeenCalled();
  });
});
