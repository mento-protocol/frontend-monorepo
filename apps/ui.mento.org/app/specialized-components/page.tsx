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
  Skeleton,
  ProposalCard,
  ProposalCardBody,
  ProposalCardFooter,
  ProposalCardHeader,
  ProposalList,
  ProposalListItem,
  ProposalListItemBody,
  ProposalListItemIndex,
  BalanceGauge,
  ReserveChart,
} from "@repo/ui";
import Image from "next/image";

export default function SpecializedComponentsPage() {
  return (
    <div className="gap-8 p-6 flex w-full flex-col">
      <div className="space-y-2">
        <h1 className="font-bold text-3xl">Specialized Components</h1>
        <p className="text-muted-foreground">Domain-specific UI components</p>
      </div>

      <div className="gap-6 md:grid-cols-2 grid grid-cols-1">
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
            <div className="gap-2 flex flex-wrap">
              <ProposalStatus variant="active">Active</ProposalStatus>
              <ProposalStatus variant="succeeded">Succeeded</ProposalStatus>
              <ProposalStatus variant="defeated">Defeated</ProposalStatus>
              <ProposalStatus variant="pending">Pending</ProposalStatus>
            </div>
            <div className="gap-2 flex flex-wrap">
              <ProposalStatus variant="queued">Queued</ProposalStatus>
              <ProposalStatus variant="executed">Executed</ProposalStatus>
              <ProposalStatus variant="canceled">Canceled</ProposalStatus>
            </div>
          </CardContent>
        </Card>

        {/* Skeleton */}
        <Card>
          <CardHeader>
            <CardTitle>Skeleton</CardTitle>
            <CardDescription>Loading placeholders</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>

        {/* Proposal Card */}
        <ProposalCard>
          <ProposalCardHeader>
            <span className="font-medium">Proposal #42</span>
          </ProposalCardHeader>
          <ProposalCardBody>
            <p className="text-sm text-muted-foreground">
              Increase the stability pool cap to 10M.
            </p>
          </ProposalCardBody>
          <ProposalCardFooter>
            <ProposalStatus variant="active">Active</ProposalStatus>
          </ProposalCardFooter>
        </ProposalCard>

        {/* Proposal List */}
        <Card>
          <CardHeader>
            <CardTitle>Proposal List</CardTitle>
            <CardDescription>Compact proposal rows</CardDescription>
          </CardHeader>
          <CardContent>
            <ProposalList>
              <ProposalListItem>
                <ProposalListItemIndex index="1" />
                <ProposalListItemBody>First proposal</ProposalListItemBody>
              </ProposalListItem>
              <ProposalListItem>
                <ProposalListItemIndex index="2" />
                <ProposalListItemBody>Second proposal</ProposalListItemBody>
              </ProposalListItem>
            </ProposalList>
          </CardContent>
        </Card>
        {/* Charts */}
        <Card>
          <CardHeader>
            <CardTitle>Charts</CardTitle>
            <CardDescription>
              Reserve and balance visualizations
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-6 flex flex-wrap items-center justify-around">
            <BalanceGauge
              token0Percent={33.3}
              token1Percent={66.7}
              token0Reserves="333K"
              token1Reserves="667K"
              token0Symbol="GBPm"
              token1Symbol="USDm"
              exchangeRate="1.33"
              inputSymbol="GBPm"
              outputSymbol="USDm"
            />
            <div className="h-40 w-40">
              <ReserveChart
                data={[
                  { name: "USDC", value: 40, color: "#3b82f6" },
                  { name: "CELO", value: 35, color: "#f59e0b" },
                  { name: "ETH", value: 25, color: "#10b981" },
                ]}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <CommunityCard />
    </div>
  );
}
