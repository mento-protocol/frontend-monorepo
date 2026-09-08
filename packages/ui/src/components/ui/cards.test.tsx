import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CommunityCard } from "./community-card.js";
import {
  LockCard,
  LockCardActions,
  LockCardAmount,
  LockCardBadge,
  LockCardBody,
  LockCardButton,
  LockCardDelegationAddress,
  LockCardDelegationLabel,
  LockCardField,
  LockCardFieldLabel,
  LockCardFieldValue,
  LockCardFooter,
  LockCardHeader,
  LockCardHeaderGroup,
  LockCardLogo,
  LockCardName,
  LockCardNotice,
  LockCardOrigin,
  LockCardOriginFlag,
  LockCardOriginText,
  LockCardRow,
  LockCardSupply,
  LockCardSymbol,
  LockCardToken,
} from "./lock-card.js";
import {
  ProposalCard,
  ProposalCardBody,
  ProposalCardFooter,
  ProposalCardHeader,
} from "./proposal-card.js";
import {
  ProposalList,
  ProposalListItem,
  ProposalListItemBody,
  ProposalListItemIndex,
} from "./proposal-list.js";

afterEach(cleanup);

describe("card components", () => {
  it("composes every lock card region", () => {
    render(
      <LockCard variant="horizontal" className="custom-card">
        <LockCardHeader>
          <LockCardHeaderGroup>
            <LockCardSymbol>CELO</LockCardSymbol>
            <LockCardName>Celo</LockCardName>
          </LockCardHeaderGroup>
          <LockCardLogo>logo</LockCardLogo>
        </LockCardHeader>
        <LockCardBody>
          <LockCardAmount>100</LockCardAmount>
          <LockCardToken>CELO</LockCardToken>
          <LockCardDelegationLabel>Delegated to</LockCardDelegationLabel>
          <LockCardDelegationAddress>0x1234</LockCardDelegationAddress>
          <LockCardRow>
            <LockCardField>
              <LockCardFieldLabel>Unlock date</LockCardFieldLabel>
              <LockCardFieldValue>Tomorrow</LockCardFieldValue>
            </LockCardField>
          </LockCardRow>
        </LockCardBody>
        <LockCardFooter>
          <LockCardOrigin>
            <LockCardOriginFlag>flag</LockCardOriginFlag>
            <LockCardOriginText>Origin</LockCardOriginText>
          </LockCardOrigin>
          <LockCardSupply>1,000</LockCardSupply>
        </LockCardFooter>
        <LockCardActions>
          <LockCardButton>Manage</LockCardButton>
        </LockCardActions>
        <LockCardNotice>Notice</LockCardNotice>
      </LockCard>,
    );

    expect(screen.getAllByText("CELO")).toHaveLength(2);
    expect(screen.getByText("Supply:")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage" })).toBeTruthy();
    expect(screen.getByText("Notice")).toBeTruthy();
  });

  it("renders every lock status and the default card variant", () => {
    render(
      <LockCard>
        {(
          ["personal", "delegated", "received", "expired", "unlocked"] as const
        ).map((type) => (
          <LockCardBadge key={type} type={type}>
            {type}
          </LockCardBadge>
        ))}
        <LockCardBadge>default status</LockCardBadge>
      </LockCard>,
    );

    expect(screen.getByText("personal").className).toContain("bg-executed");
    expect(screen.getByText("unlocked").className).toContain("bg-success");
    expect(screen.getByText("default status").className).toContain(
      "bg-executed",
    );
  });

  it("composes proposal cards and lists with optional indexes", () => {
    render(
      <ProposalCard>
        <ProposalCardHeader variant="highlighted">
          Proposal 1
        </ProposalCardHeader>
        <ProposalCardBody>
          <ProposalList>
            <ProposalListItem>
              <ProposalListItemIndex index={0} />
              <ProposalListItemBody>First body</ProposalListItemBody>
            </ProposalListItem>
            <ProposalListItem>
              <ProposalListItemIndex />
              <ProposalListItemBody>Second body</ProposalListItemBody>
            </ProposalListItem>
          </ProposalList>
        </ProposalCardBody>
        <ProposalCardFooter>Footer</ProposalCardFooter>
      </ProposalCard>,
    );

    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("First body")).toBeTruthy();
    expect(screen.getByText("Footer")).toBeTruthy();
  });

  it("renders the default and custom community calls to action", () => {
    const { rerender } = render(<CommunityCard />);

    expect(
      screen.getByRole("heading", { name: "Join our community" }),
    ).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "http://discord.mento.org",
    );

    rerender(
      <CommunityCard
        title="Builders"
        description="Build with Mento."
        buttonText="Open Discord"
        buttonHref="https://discord.example"
      />,
    );

    expect(screen.getByRole("heading", { name: "Builders" })).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://discord.example",
    );
  });
});
