// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validAddress = "0x1111111111111111111111111111111111111111";
const mocks = vi.hoisted(() => ({
  balanceLoading: false,
  connected: true,
  mento: 100n,
  proposalLoading: false,
  proposals: [] as Array<{ metadata: { title: string } }>,
  state: { title: "Unique title", description: "", code: "" },
  step: 1,
  setStep: vi.fn(),
  submit: vi.fn(),
  threshold: 50n,
  thresholdLoading: false,
  update: vi.fn(),
  veMento: 100n,
}));

vi.mock("@/contracts/governor", () => ({
  useProposalThreshold: () => ({
    proposalThreshold: mocks.threshold,
    isLoadingProposalThreshold: mocks.thresholdLoading,
  }),
  useProposals: () => ({
    proposals: mocks.proposals,
    isLoading: mocks.proposalLoading,
  }),
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ isConnected: mocks.connected }),
}));
vi.mock("@repo/web3", () => ({
  ConnectButton: () => <button>connect account</button>,
  formatUnitsWithThousandSeparators: (value: bigint) => `formatted:${value}`,
  isValidAddress: (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value),
  useTokens: () => ({
    veMentoBalance: { value: mocks.veMento, decimals: 18 },
    mentoBalance: { value: mocks.mento, decimals: 18 },
    isBalanceLoading: mocks.balanceLoading,
  }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("lucide-react", () => ({
  ArrowLeft: () => <span>left</span>,
  ArrowRight: () => <span>right</span>,
  HelpCircle: () => <span>help</span>,
}));
vi.mock("./create-proposal-provider", () => ({
  CreateProposalProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  CreateProposalStep: { content: 1, execution: 2, preview: 3 },
  useCreateProposal: () => ({
    step: mocks.step,
    setStep: mocks.setStep,
    newProposal: mocks.state,
    updateProposal: mocks.update,
    submitProposal: mocks.submit,
  }),
}));
vi.mock("@mento-protocol/ui", () => {
  const Box = ({
    children,
    asChild: _asChild,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }) => {
    void _asChild;
    return <div {...props}>{children}</div>;
  };
  return {
    Breadcrumb: Box,
    BreadcrumbItem: Box,
    BreadcrumbList: Box,
    BreadcrumbSeparator: () => <span>/</span>,
    BreadcrumbLink: ({
      children,
      href,
      ...props
    }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={href} {...props}>
        {children}
      </a>
    ),
    Button: ({
      children,
      asChild: _asChild,
      clipped: _clipped,
      variant: _variant,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      asChild?: boolean;
      clipped?: string;
      variant?: string;
    }) => {
      void _asChild;
      void _clipped;
      void _variant;
      return <button {...props}>{children}</button>;
    },
    Card: Box,
    CardContent: Box,
    CardHeader: Box,
    cn: (...values: Array<string | false | undefined>) =>
      values.filter(Boolean).join(" "),
    IconLoading: () => <span>loading</span>,
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
      <input {...props} />
    ),
    Label: ({ children }: { children: React.ReactNode }) => (
      <label>{children}</label>
    ),
    RichTextEditor: ({
      value,
      onChange,
    }: {
      value: string;
      onChange: (value: string) => void;
    }) => (
      <textarea
        aria-label="rich editor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
    Tabs: Box,
    TabsContent: Box,
    TabsList: Box,
    TabsTrigger: ({ children }: { children: React.ReactNode }) => (
      <button>{children}</button>
    ),
    Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
      <textarea {...props} />
    ),
    Tooltip: Box,
    TooltipContent: Box,
    TooltipTrigger: Box,
  };
});

import CreateProposalForm from "./create-proposal-form";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("scrollTo", vi.fn());
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    value: 500,
  });
  Object.assign(mocks, {
    balanceLoading: false,
    connected: true,
    mento: 100n,
    proposalLoading: false,
    proposals: [],
    state: { title: "Unique title", description: "", code: "" },
    step: 1,
    threshold: 50n,
    thresholdLoading: false,
    veMento: 100n,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CreateProposalForm", () => {
  it("renders balance loading, insufficient balance, and disconnected states", () => {
    mocks.balanceLoading = true;
    const { rerender } = render(<CreateProposalForm />);
    expect(screen.getByText("loading")).toBeTruthy();
    mocks.balanceLoading = false;
    mocks.thresholdLoading = true;
    rerender(<CreateProposalForm />);
    expect(screen.getByText("loading")).toBeTruthy();
    mocks.thresholdLoading = false;
    mocks.veMento = 1n;
    rerender(<CreateProposalForm />);
    expect(screen.getByText("Not enough veMENTO")).toBeTruthy();
    expect(screen.getByText(/formatted:50/)).toBeTruthy();
    cleanup();
    mocks.veMento = 100n;
    mocks.connected = false;
    render(<CreateProposalForm />);
    expect(screen.getByText("Connect Wallet")).toBeTruthy();
  });

  it("validates and updates proposal details", () => {
    const { rerender } = render(<CreateProposalForm />);
    fireEvent.change(screen.getByTestId("proposalTitleInput"), {
      target: { value: "New title" },
    });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New title" }),
    );
    fireEvent.change(screen.getByLabelText("rich editor"), {
      target: { value: `<h1>Heading</h1><p>${"a".repeat(110)}</p><hr>` },
    });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("Heading"),
      }),
    );
    mocks.state = { ...mocks.state, title: "Duplicate" };
    mocks.proposals = [{ metadata: { title: " duplicate " } }];
    rerender(<CreateProposalForm />);
    expect(
      (screen.getByTestId("nextButton") as HTMLButtonElement).disabled,
    ).toBe(true);
    mocks.state = {
      title: "Unique title",
      description: "a".repeat(110),
      code: "",
    };
    mocks.proposals = [];
    rerender(<CreateProposalForm />);
    fireEvent.change(screen.getByLabelText("rich editor"), {
      target: { value: `<p>${"a".repeat(110)}</p>` },
    });
    fireEvent.click(screen.getByTestId("nextButton"));
    expect(mocks.setStep).toHaveBeenCalledWith(2);
  });

  it.each([
    "",
    "bad",
    "{}",
    "[]",
    "[{}]",
    `[{"address":"${validAddress}"}]`,
    `[{"address":"${validAddress}","value":0}]`,
    '[{"address":"bad","value":0,"data":"0x"}]',
    `[{"address":"${validAddress}","value":0,"data":"bad"}]`,
  ])("validates execution code %s", (code) => {
    mocks.step = 2;
    mocks.state = { ...mocks.state, code };
    render(<CreateProposalForm />);
    const button = screen.getByTestId("nextButton") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain(
      code ? "Invalid execution code" : "Next",
    );
  });

  it("moves between execution and review for valid code", () => {
    mocks.step = 2;
    mocks.state = {
      ...mocks.state,
      code: `[{"address":"${validAddress}","value":0,"data":"0x1234"}]`,
    };
    render(<CreateProposalForm />);
    fireEvent.click(screen.getByTestId("nextButton"));
    expect(mocks.setStep).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByTestId("previousButton"));
    expect(mocks.setStep).toHaveBeenCalledWith(1);
  });

  it("reviews, expands, submits, and returns to execution", () => {
    mocks.step = 3;
    mocks.state = {
      title: "Review title",
      description:
        "# Heading\n\n**bold** *italic*\n\n---\n\n[link](https://example.com)",
      code: '{"bad":true}',
    };
    render(<CreateProposalForm />);
    vi.runAllTimers();
    fireEvent.click(screen.getByTestId("seeAll_proposalDetailsButton"));
    fireEvent.click(screen.getByTestId("seeLess_proposalDetailsButton"));
    fireEvent.click(screen.getByTestId("seeAll_executionCodeButton"));
    fireEvent.click(screen.getByTestId("seeLess_executionCodeButton"));
    fireEvent.click(screen.getByTestId("createProposalButton"));
    expect(mocks.submit).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("previousButton"));
    expect(mocks.setStep).toHaveBeenCalledWith(2);
  });

  it("navigates through breadcrumbs", () => {
    mocks.step = 3;
    render(<CreateProposalForm />);
    fireEvent.click(screen.getAllByText("Proposal Details")[0]!);
    fireEvent.click(screen.getAllByText("Execution Code")[0]!);
    fireEvent.click(screen.getAllByText("Review")[0]!);
    expect(mocks.setStep).toHaveBeenCalledTimes(3);
  });
});
