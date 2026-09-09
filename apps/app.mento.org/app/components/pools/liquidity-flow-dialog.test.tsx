// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Step = {
  id: string;
  label: string;
  status: "idle" | "pending" | "confirming" | "confirmed" | "error";
  txHash?: string;
  error?: Error;
};
const mocks = vi.hoisted(() => ({
  flow: null as null | {
    operation: string;
    chainId: number;
    currentStepIndex: number;
    steps: Step[];
  },
  setFlow: vi.fn(),
}));

vi.mock("jotai", () => ({ useAtom: () => [mocks.flow, mocks.setFlow] }));
vi.mock("@repo/web3", () => ({
  liquidityFlowAtom: {},
  useExplorerUrl: () => "https://explorer.test",
}));
vi.mock("@mento-protocol/ui", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Dialog: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      {children}
      <button onClick={() => onOpenChange(false)}>dismiss</button>
    </div>
  ),
  DialogContent: ({
    children,
    onPointerDownOutside,
    onEscapeKeyDown,
  }: {
    children: React.ReactNode;
    onPointerDownOutside: (event: {
      target: HTMLElement;
      preventDefault: () => void;
    }) => void;
    onEscapeKeyDown: (event: { preventDefault: () => void }) => void;
  }) => (
    <section>
      {children}
      <button
        onClick={(event) =>
          onPointerDownOutside({
            target: event.currentTarget,
            preventDefault: vi.fn(),
          })
        }
      >
        outside
      </button>
      <button
        data-sonner-toast
        onClick={(event) =>
          onPointerDownOutside({
            target: event.currentTarget,
            preventDefault: vi.fn(),
          })
        }
      >
        toast
      </button>
      <button onClick={() => onEscapeKeyDown({ preventDefault: vi.fn() })}>
        escape
      </button>
    </section>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
}));

import { LiquidityFlowDialog } from "./liquidity-flow-dialog";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flow = null;
});
afterEach(cleanup);

function setFlow(steps: Step[]) {
  mocks.flow = {
    operation: "Add liquidity",
    chainId: 42220,
    currentStepIndex: 1,
    steps,
  };
}

describe("LiquidityFlowDialog", () => {
  it("renders nothing without a flow", () => {
    const { container } = render(<LiquidityFlowDialog />);
    expect(container.innerHTML).toBe("");
  });

  it("renders every progress status and transaction link", () => {
    setFlow([
      { id: "idle", label: "Idle", status: "idle" },
      {
        id: "pending",
        label: "Pending",
        status: "pending",
        txHash: "0x1234567890abcdef123456",
      },
      { id: "confirming", label: "Confirming", status: "confirming" },
      {
        id: "confirmed",
        label: "Confirmed",
        status: "confirmed",
        txHash: "short",
      },
    ]);
    render(<LiquidityFlowDialog />);
    expect(
      screen.getByText("Please confirm the transactions in your wallet."),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "0x123456...123456" })
        .getAttribute("href"),
    ).toBe("https://explorer.test/tx/0x1234567890abcdef123456");
    expect(screen.getByRole("link", { name: "short" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "outside" }));
    fireEvent.click(screen.getByRole("button", { name: "toast" }));
    fireEvent.click(screen.getByRole("button", { name: "escape" }));
  });

  it("closes a completed flow", () => {
    setFlow([{ id: "done", label: "Done step", status: "confirmed" }]);
    render(<LiquidityFlowDialog />);
    expect(screen.getByText("All steps completed successfully.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(mocks.setFlow).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    expect(mocks.setFlow).toHaveBeenCalledTimes(2);
  });

  it("shows and closes an error", () => {
    setFlow([
      {
        id: "error",
        label: "Failed step",
        status: "error",
        error: new Error("reverted"),
      },
    ]);
    render(<LiquidityFlowDialog />);
    expect(
      screen.getByText("An error occurred during the transaction."),
    ).toBeTruthy();
    expect(screen.getByText("reverted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(mocks.setFlow).toHaveBeenCalledWith(null);
  });
});
