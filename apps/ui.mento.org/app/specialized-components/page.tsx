"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CoinCard,
  CoinCardFooter,
  CoinCardHeader,
  CoinCardHeaderGroup,
  CoinCardLogo,
  CoinCardName,
  CoinCardOrigin,
  CoinCardOriginFlag,
  CoinCardOriginText,
  CoinCardSupply,
  CoinCardSymbol,
  CommunityCard,
  ProposalStatus,
} from "@repo/ui";
import Image from "next/image";
import USFlag from "../components/client/icons/us";

export default function SpecializedComponentsPage() {
  return (
    <div className="flex w-full flex-col gap-8 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Specialized Components</h1>
        <p className="text-muted-foreground">Domain-specific UI components</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Coin Card */}
        <CoinCard>
          <CoinCardHeader>
            <CoinCardHeaderGroup>
              <CoinCardSymbol>cUSD</CoinCardSymbol>
              <CoinCardName>Celo Dollar</CoinCardName>
            </CoinCardHeaderGroup>
            <CoinCardLogo>
              <Image
                src="/celoDollar.png"
                alt="Celo Dollar"
                width={56}
                height={56}
                className="h-14 w-14"
              />
            </CoinCardLogo>
          </CoinCardHeader>
          <CoinCardFooter>
            <CoinCardOrigin>
              <CoinCardOriginFlag>
                <USFlag className="h-4 w-4" />
              </CoinCardOriginFlag>
              <CoinCardOriginText>United States</CoinCardOriginText>
            </CoinCardOrigin>
            <CoinCardSupply>$464,278</CoinCardSupply>
          </CoinCardFooter>
        </CoinCard>

        {/* Proposal Status */}
        <Card>
          <CardHeader>
            <CardTitle>Proposal Status</CardTitle>
            <CardDescription>Status indicators for proposals</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <ProposalStatus variant="active">Active</ProposalStatus>
              <ProposalStatus variant="succeeded">Succeeded</ProposalStatus>
              <ProposalStatus variant="defeated">Defeated</ProposalStatus>
            </div>
            <div className="flex flex-wrap gap-2">
              <ProposalStatus variant="pending">Pending</ProposalStatus>
              <ProposalStatus variant="queued">Queued</ProposalStatus>
              <ProposalStatus variant="executed">Executed</ProposalStatus>
            </div>
          </CardContent>
        </Card>
      </div>

      <CommunityCard />
    </div>
  );
}
