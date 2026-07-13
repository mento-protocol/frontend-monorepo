import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { addresses, ChainId } from "@mento-protocol/mento-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

const CELO_MAINNET_EXPLORER_URL = "https://celoscan.io";
// The real Celo mainnet contract addresses, straight from the SDK's own
// mapping. Using these (instead of hardcoded copies) both for the mock and
// the assertions means a change to the SDK's addresses, or a regression in
// how the component wires them up, actually fails this test.
const celoAddresses = addresses[ChainId.CELO];

vi.mock("@mento-protocol/ui", () => ({
  Accordion: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AccordionItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AccordionTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AccordionContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopyToClipboard: () => <span>Copy</span>,
}));

// useContracts stays mocked: unmocking it means importing @repo/web3's real
// barrel, which transitively pulls in RainbowKit's CSS. Vitest's CSS
// pipeline then runs the app's postcss.config.mjs (a Next.js-style config,
// string plugin names) and fails ("Invalid PostCSS Plugin") — an unrelated
// build-pipeline problem, not something this test should have to fix. So the
// mock stays, but its addresses come straight from the SDK instead of being
// copy-pasted, so a change to the SDK's mapping (or a wiring bug that swaps
// which contract goes where) still fails this test.
vi.mock("@repo/web3", () => ({
  useContracts: () => ({
    MentoToken: { address: celoAddresses.MentoToken },
    TimelockController: { address: celoAddresses.TimelockController },
    MentoGovernor: { address: celoAddresses.MentoGovernor },
    Locking: { address: celoAddresses.Locking },
  }),
  useAccount: () => ({ chain: undefined }),
  useTokens: () => ({
    mentoContractData: { totalSupply: 0n, decimals: 18 },
  }),
  NumbersService: { parseNumericValue: (value: string) => value },
  shortenAddress: (address: string) => address,
}));

vi.mock("@/contracts", () => ({
  useGovernanceDetails: () => ({
    proposalThreshold: undefined,
    quorumNeeded: undefined,
    votingPeriodFormatted: undefined,
    timeLockFormatted: undefined,
  }),
}));

vi.mock("@/hooks/use-current-chain", () => ({
  useCurrentChain: () => ({
    blockExplorers: { default: { url: CELO_MAINNET_EXPLORER_URL } },
  }),
}));

import { MentoTokenInfo } from "./mento-token-info";

describe("MentoTokenInfo contract address links", () => {
  afterEach(() => {
    cleanup();
  });

  it("links governor/mento/timelock/veMENTO to their mainnet Celoscan pages", () => {
    render(<MentoTokenInfo />);

    expect(
      (screen.getByTestId("governor-address-button") as HTMLAnchorElement).href,
    ).toBe(
      `${CELO_MAINNET_EXPLORER_URL}/address/${celoAddresses.MentoGovernor}`,
    );
    expect(
      (screen.getByTestId("mento-address-button") as HTMLAnchorElement).href,
    ).toBe(`${CELO_MAINNET_EXPLORER_URL}/address/${celoAddresses.MentoToken}`);
    expect(
      (screen.getByTestId("timelock-address-button") as HTMLAnchorElement).href,
    ).toBe(
      `${CELO_MAINNET_EXPLORER_URL}/address/${celoAddresses.TimelockController}`,
    );
    expect(
      (screen.getByTestId("veMento-address-button") as HTMLAnchorElement).href,
    ).toBe(`${CELO_MAINNET_EXPLORER_URL}/address/${celoAddresses.Locking}`);
  });
});
