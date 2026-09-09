// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0x00000000000000000000000000000000000000aa" as string | undefined,
  amount: "2" as string | undefined,
  approvalStatus: "NOT_APPROVED",
  approve: {
    approveMento: vi.fn(),
    error: null as Error | null,
    isAwaitingUserSignature: false,
    isConfirming: false,
    reset: vi.fn(),
  },
  createLock: vi.fn(),
  createStatus: "UNKNOWN",
  delegateAddress: "0x00000000000000000000000000000000000000bb" as
    | string
    | undefined,
  delegateEnabled: false,
  errors: {} as Record<string, { type: string }>,
  formValid: true,
  lockAmounts: new Map<string, { remainingMento: bigint }>(),
  onConfirmation: null as null | (() => void),
  refetch: vi.fn(),
  relock: {
    error: null as Error | null,
    hash: "0xhash",
    isAwaitingUserSignature: false,
    isConfirming: false,
    relockMento: vi.fn(),
    reset: vi.fn(),
  },
  resetForm: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  unlockDate: new Date("2027-01-01T00:00:00Z") as Date | undefined,
}));

vi.mock("@/contracts", () => ({
  useApprove: () => mocks.approve,
  useLockInfo: () => ({ refetch: mocks.refetch }),
  useLockingWeek: () => ({ currentWeek: 10n }),
  useRelockMento: (options: { onConfirmation: () => void }) => {
    mocks.onConfirmation = options.onConfirmation;
    return mocks.relock;
  },
}));
vi.mock("@/contracts/locking/config", () => ({
  LOCKING_AMOUNT_FORM_KEY: "amount",
  LOCKING_DELEGATE_ADDRESS_FORM_KEY: "delegateAddress",
  LOCKING_DELEGATE_ENABLED_FORM_KEY: "delegateEnabled",
  LOCKING_UNLOCK_DATE_FORM_KEY: "unlockDate",
}));
vi.mock("@/hooks/use-current-chain", () => ({
  useCurrentChain: () => ({
    blockExplorers: { default: { url: "https://explorer.test" } },
  }),
}));
vi.mock("@/hooks/use-lock-amounts-from-withdrawals", () => ({
  useLockAmountsFromWithdrawals: () => ({ lockAmountsMap: mocks.lockAmounts }),
}));
vi.mock("@mento-protocol/ui", () => ({
  Button: ({
    children,
    clipped: _clipped,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    clipped?: string;
    size?: string;
  }) => {
    void _clipped;
    void _size;
    return <button {...props}>{children}</button>;
  },
  cn: (...values: Array<string | undefined>) =>
    values.filter(Boolean).join(" "),
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock("@repo/web3", () => ({
  isValidAddress: (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value),
  useContracts: () => ({ Locking: { address: "0xlocking" } }),
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: mocks.address }),
}));
vi.mock("react-hook-form", () => ({
  useFormContext: () => ({
    watch: (key: string) =>
      ({
        amount: mocks.amount,
        unlockDate: mocks.unlockDate,
        delegateEnabled: mocks.delegateEnabled,
        delegateAddress: mocks.delegateAddress,
      })[key],
    formState: { isValid: mocks.formValid, errors: mocks.errors },
    handleSubmit: (callback: () => void) => () => callback(),
    reset: mocks.resetForm,
  }),
}));
vi.mock("./create-lock-provider", () => ({
  CREATE_LOCK_APPROVAL_STATUS: {
    NOT_APPROVED: "NOT_APPROVED",
    APPROVED: "APPROVED",
    UNKNOWN: "UNKNOWN",
  },
  LOCK_TX_STATUS: {
    CONFIRMING_LOCK_TX: "CONFIRMING_LOCK_TX",
    CONFIRMING_APPROVE_TX: "CONFIRMING_APPROVE_TX",
    CONFIRMING_RELOCK_TX: "CONFIRMING_RELOCK_TX",
    AWAITING_SIGNATURE: "AWAITING_SIGNATURE",
    UNKNOWN: "UNKNOWN",
    ERROR: "ERROR",
  },
  useCreateLock: () => ({
    createLock: mocks.createLock,
    CreateLockTxStatus: mocks.createStatus,
    CreateLockApprovalStatus: mocks.approvalStatus,
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
    <div data-error={String(error)}>
      {message}
      {isOpen && (
        <>
          <button onClick={onClose}>close dialog</button>
          <button onClick={retry}>retry relock</button>
        </>
      )}
    </div>
  ),
}));

import { LockingButton } from "./locking-button";

type LockToUpdate = NonNullable<
  React.ComponentProps<typeof LockingButton>["lockToUpdate"]
>;

const targetLock = {
  lockId: "1",
  owner: { id: "0x00000000000000000000000000000000000000aa" },
  delegate: { id: "0x00000000000000000000000000000000000000aa" },
  amount: "2000000000000000000",
  cliff: 0n,
  slope: 20n,
  time: 5n,
  expiration: new Date("2026-06-01T00:00:00Z"),
} as unknown as LockToUpdate;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  vi.clearAllMocks();
  Object.assign(mocks, {
    address: "0x00000000000000000000000000000000000000aa",
    amount: "2",
    approvalStatus: "NOT_APPROVED",
    createStatus: "UNKNOWN",
    delegateAddress: "0x00000000000000000000000000000000000000bb",
    delegateEnabled: false,
    errors: {},
    formValid: true,
    lockAmounts: new Map(),
    unlockDate: new Date("2027-01-01T00:00:00Z"),
  });
  Object.assign(mocks.approve, {
    error: null,
    isAwaitingUserSignature: false,
    isConfirming: false,
  });
  Object.assign(mocks.relock, {
    error: null,
    hash: "0xhash",
    isAwaitingUserSignature: false,
    isConfirming: false,
  });
  mocks.approve.approveMento.mockImplementation(
    ({ onConfirmation }: { onConfirmation: () => void }) => onConfirmation(),
  );
  mocks.relock.relockMento.mockImplementation(
    ({ onSuccess }: { onSuccess: () => void }) => onSuccess(),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LockingButton", () => {
  it("handles disconnected and new-lock states", () => {
    mocks.address = undefined;
    const { rerender } = render(<LockingButton />);
    expect(
      screen
        .getByRole("button", { name: "Connect wallet" })
        .getAttribute("data-testid"),
    ).toBe("connectWalletButton");
    mocks.address = "0x00000000000000000000000000000000000000aa";
    rerender(<LockingButton />);
    expect(screen.getByRole("button", { name: "Approve MENTO" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve MENTO" }));
    expect(mocks.createLock).toHaveBeenCalled();
    mocks.approvalStatus = "APPROVED";
    rerender(<LockingButton />);
    expect(screen.getByRole("button", { name: "Lock MENTO" })).toBeTruthy();
  });

  it("rejects invalid, empty, low, and excessive amounts", () => {
    mocks.amount = "bad";
    const { rerender } = render(<LockingButton />);
    expect(screen.getByRole("button", { name: "Enter amount" })).toBeTruthy();
    mocks.amount = "";
    rerender(<LockingButton />);
    expect(screen.getByRole("button", { name: "Enter amount" })).toBeTruthy();
    mocks.amount = "2";
    mocks.errors = { amount: { type: "min" } };
    rerender(<LockingButton />);
    expect(
      screen.getByRole("button", { name: "Minimum 1 MENTO" }),
    ).toBeTruthy();
    mocks.amount = "999";
    mocks.errors = { amount: { type: "max" } };
    rerender(<LockingButton />);
    expect(
      screen.getByRole("button", { name: "Insufficient balance" }),
    ).toBeTruthy();
  });

  it("approves and submits a top-up relock", () => {
    mocks.lockAmounts = new Map([["1", { remainingMento: 1n * 10n ** 18n }]]);
    render(<LockingButton lockToUpdate={targetLock} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve MENTO" }));
    expect(mocks.approve.approveMento).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3n * 10n ** 18n, target: "0xlocking" }),
    );
    expect(mocks.relock.relockMento).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "close dialog" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "close dialog" }));
    expect(mocks.approve.reset).toHaveBeenCalled();
  });

  it("extends a lock without a token transfer", () => {
    mocks.amount = "0";
    render(<LockingButton lockToUpdate={targetLock} />);
    const button = screen.getByRole("button", { name: "Extend lock" });
    expect(button.getAttribute("data-testid")).toBe("extendLockButton");
    fireEvent.click(button);
    expect(mocks.approve.approveMento).not.toHaveBeenCalled();
    expect(mocks.relock.relockMento).toHaveBeenCalled();
  });

  it("changes delegation to another account and back to self", () => {
    mocks.amount = "0";
    mocks.unlockDate = targetLock.expiration;
    mocks.delegateEnabled = true;
    const { rerender } = render(<LockingButton lockToUpdate={targetLock} />);
    expect(
      screen.getByRole("button", { name: "Change delegate" }),
    ).toBeTruthy();
    mocks.delegateAddress = "0x00000000000000000000000000000000000000aa";
    rerender(
      <LockingButton
        lockToUpdate={
          {
            ...targetLock,
            delegate: { id: "0x00000000000000000000000000000000000000bb" },
          } as LockToUpdate
        }
      />,
    );
    expect(
      screen.getByRole("button", { name: "Delegate to self" }),
    ).toBeTruthy();
  });

  it("shows approval and relock transaction states", () => {
    mocks.approve.isAwaitingUserSignature = true;
    const { rerender, container } = render(
      <LockingButton lockToUpdate={targetLock} />,
    );
    expect(screen.getByText("Continue in wallet")).toBeTruthy();
    mocks.approve.isAwaitingUserSignature = false;
    mocks.approve.isConfirming = true;
    rerender(<LockingButton lockToUpdate={targetLock} />);
    expect(screen.getByText("Confirming...")).toBeTruthy();
    mocks.approve.isConfirming = false;
    mocks.relock.isAwaitingUserSignature = true;
    rerender(<LockingButton lockToUpdate={targetLock} />);
    expect(screen.getByText("Continue in wallet")).toBeTruthy();
    mocks.relock.isAwaitingUserSignature = false;
    mocks.relock.isConfirming = true;
    rerender(<LockingButton lockToUpdate={targetLock} />);
    expect(screen.getByText("Confirming...")).toBeTruthy();
    expect(container.querySelector("[data-error='false']")).toBeTruthy();
  });

  it("reports approval and relock failures", () => {
    mocks.approve.error = new Error("User rejected request");
    const { rerender, container } = render(
      <LockingButton lockToUpdate={targetLock} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve MENTO" }));
    expect(mocks.toastError).toHaveBeenCalledWith("Transaction rejected");
    mocks.approve.error = null;
    mocks.relock.error = new Error("rpc failed");
    rerender(<LockingButton lockToUpdate={targetLock} />);
    expect(mocks.toastError).toHaveBeenCalledWith("Transaction failed");
    expect(container.querySelector("[data-error='true']")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "retry relock" }));
  });

  it("handles callback errors and a confirmed relock", () => {
    mocks.approve.approveMento.mockImplementation(
      ({ onError }: { onError: (error: Error) => void }) =>
        onError(new Error("denied")),
    );
    const { rerender } = render(<LockingButton lockToUpdate={targetLock} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve MENTO" }));
    expect(mocks.toastError).toHaveBeenCalledWith("Failed to approve MENTO");
    mocks.amount = "0";
    mocks.relock.relockMento.mockImplementation(
      ({ onError }: { onError: (error: Error) => void }) =>
        onError(new Error("revert")),
    );
    rerender(<LockingButton lockToUpdate={targetLock} />);
    fireEvent.click(screen.getByRole("button", { name: "Extend lock" }));
    expect(mocks.toastError).toHaveBeenCalledWith("Failed to update lock");
    act(() => mocks.onConfirmation?.());
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(mocks.resetForm).toHaveBeenCalled();
    act(() => vi.runAllTimers());
    expect(mocks.refetch).toHaveBeenCalledTimes(4);
  });

  it("blocks invalid form and active create transactions", () => {
    mocks.formValid = false;
    const { rerender } = render(<LockingButton />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      true,
    );
    mocks.formValid = true;
    mocks.createStatus = "AWAITING_SIGNATURE";
    rerender(<LockingButton />);
    expect(
      (
        screen.getByRole("button", {
          name: "Approve MENTO",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
