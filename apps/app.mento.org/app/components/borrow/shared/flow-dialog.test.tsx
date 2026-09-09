// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flow: null as null | {
    operation: string;
    currentStepIndex: number;
    successHref?: string;
    steps: Array<{ id: string; label: string; status: string }>;
  },
  push: vi.fn(),
  setFlow: vi.fn(),
}));

vi.mock("jotai", () => ({ useAtom: () => [mocks.flow, mocks.setFlow] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@repo/web3", () => ({ borrowFlowAtom: {} }));
vi.mock("./flow-step", () => ({
  FlowStep: ({
    step,
    isActive,
  }: {
    step: { label: string };
    isActive: boolean;
  }) => (
    <span>
      {step.label}:{String(isActive)}
    </span>
  ),
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
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
}));

import { FlowDialog } from "./flow-dialog";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flow = null;
});
afterEach(cleanup);

function flow(status: string, successHref?: string) {
  mocks.flow = {
    operation: "Adjust position",
    currentStepIndex: 0,
    successHref,
    steps: [{ id: "one", label: "First step", status }],
  };
}

describe("FlowDialog", () => {
  it("renders nothing without an active flow", () => {
    const { container } = render(<FlowDialog />);
    expect(container.innerHTML).toBe("");
  });

  it("shows pending progress", () => {
    flow("pending");
    render(<FlowDialog />);
    expect(
      screen.getByText("Please confirm the transactions in your wallet."),
    ).toBeTruthy();
    expect(screen.getByText("First step:true")).toBeTruthy();
  });

  it.each([
    [undefined, "Done"],
    ["/borrow", "Back to Dashboard"],
    ["/borrow/manage/1", "View Position"],
    ["/earn", "Continue"],
  ])("handles a completed flow to %s", (successHref, label) => {
    flow("confirmed", successHref);
    render(<FlowDialog />);
    expect(screen.getByText("All steps completed successfully.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(mocks.setFlow).toHaveBeenCalledWith(null);
    if (successHref) expect(mocks.push).toHaveBeenCalledWith(successHref);
  });

  it("clears an errored flow", () => {
    flow("error");
    render(<FlowDialog />);
    expect(
      screen.getByText("An error occurred during the transaction."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(mocks.setFlow).toHaveBeenCalledWith(null);
  });

  it("routes when a completed dialog is dismissed", () => {
    flow("confirmed", "/borrow");
    render(<FlowDialog />);
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    expect(mocks.setFlow).toHaveBeenCalledWith(null);
    expect(mocks.push).toHaveBeenCalledWith("/borrow");
  });
});
