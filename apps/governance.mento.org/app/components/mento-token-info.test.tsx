import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const GOVERNOR_ADDRESS = "0x47036d78bB3169b4F5560dD77BF93f4412A59852";
const MENTO_ADDRESS = "0x7FF62f59e3e89EA34163EA1458EEBCc81177Cfb6";
const TIMELOCK_ADDRESS = "0x890DB8A597940165901372Dd7DB61C9f246e2147";
const VE_MENTO_ADDRESS = "0x001Bb66636dCd149A1A2bA8C50E408BdDd80279C";
const CELO_MAINNET_EXPLORER_URL = "https://celoscan.io";

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

vi.mock("@repo/web3", () => ({
  useContracts: () => ({
    MentoToken: { address: MENTO_ADDRESS },
    TimelockController: { address: TIMELOCK_ADDRESS },
    MentoGovernor: { address: GOVERNOR_ADDRESS },
    Locking: { address: VE_MENTO_ADDRESS },
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
    ).toBe(`${CELO_MAINNET_EXPLORER_URL}/address/${GOVERNOR_ADDRESS}`);
    expect(
      (screen.getByTestId("mento-address-button") as HTMLAnchorElement).href,
    ).toBe(`${CELO_MAINNET_EXPLORER_URL}/address/${MENTO_ADDRESS}`);
    expect(
      (screen.getByTestId("timelock-address-button") as HTMLAnchorElement).href,
    ).toBe(`${CELO_MAINNET_EXPLORER_URL}/address/${TIMELOCK_ADDRESS}`);
    expect(
      (screen.getByTestId("veMento-address-button") as HTMLAnchorElement).href,
    ).toBe(`${CELO_MAINNET_EXPLORER_URL}/address/${VE_MENTO_ADDRESS}`);
  });
});
