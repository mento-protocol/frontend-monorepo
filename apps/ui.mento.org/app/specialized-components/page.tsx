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
  CoinCardSupply,
  CoinCardSymbol,
  CommunityCard,
  ProposalStatus,
} from "@repo/ui";
import Image from "next/image";

export default function SpecializedComponentsPage() {
  return (
    <div className="flex w-full flex-col gap-8 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Specialized Components</h1>
        <p className="text-muted-foreground">Domain-specific UI components</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <CoinCard className="h-fit">
          <CoinCardHeader className="justify-between">
            <CoinCardHeaderGroup>
              <CoinCardSymbol>USDm</CoinCardSymbol>
              <CoinCardName>Mento Dollar</CoinCardName>
            </CoinCardHeaderGroup>
            <CoinCardLogo>
              <Image
                src="/tokens/USDm.svg"
                alt="Mento Dollar"
                width={32}
                height={32}
                className="h-8 w-8"
                onError={(e) => {
                  e.currentTarget.src = "/tokens/CELO.svg";
                }}
              />
            </CoinCardLogo>
          </CoinCardHeader>
          <CoinCardFooter>
            <CoinCardSupply>$16,904,872.81</CoinCardSupply>
          </CoinCardFooter>
        </CoinCard>

        <Card>
          <CardHeader>
            <CardTitle>Governance Proposal Status</CardTitle>
            <CardDescription>Status indicators for proposals</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <ProposalStatus variant="active">Active</ProposalStatus>
              <ProposalStatus variant="succeeded">Succeeded</ProposalStatus>
              <ProposalStatus variant="defeated">Defeated</ProposalStatus>
              <ProposalStatus variant="pending">Pending</ProposalStatus>
            </div>
            <div className="flex flex-wrap gap-2">
              <ProposalStatus variant="queued">Queued</ProposalStatus>
              <ProposalStatus variant="executed">Executed</ProposalStatus>
              <ProposalStatus variant="canceled">Canceled</ProposalStatus>
            </div>
          </CardContent>
        </Card>
      </div>

      <CommunityCard />
    </div>
  );
}
