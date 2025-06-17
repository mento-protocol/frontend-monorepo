import Image from "next/image";
import { env } from "@/env.mjs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  CommunityCard,
  IconChevron,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui";
import { IconInfo } from "@repo/ui";
import { ChevronsRight, Zap } from "lucide-react";
import { Button } from "@repo/ui";

import {
  ProposalCard,
  ProposalCardHeader,
  ProposalCardBody,
  ProposalCardFooter,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  ProposalList,
  ProposalListItem,
  ProposalStatus,
} from "@repo/ui";

export default async function Home() {
  return (
    <main className="relative w-full pb-4">
      <Image
        src={`${env.NEXT_PUBLIC_STORAGE_URL}/hero-dhs5Gb3LHWTZgUR0vYoPB13ozvOpfx.png`}
        alt="Mento Reserve"
        width={320}
        height={168}
        className="my-8 w-full md:hidden"
      />
      <Image
        src={`${env.NEXT_PUBLIC_STORAGE_URL}/hero-dhs5Gb3LHWTZgUR0vYoPB13ozvOpfx.png`}
        alt="Mento Reserve"
        width={1280}
        height={605}
        className="absolute -bottom-[50px] right-12 top-0 -z-10 hidden h-[605px] w-auto object-cover md:block 2xl:left-auto 2xl:right-20"
      />
      <section className="xl:px-22 max-w-2xl px-4 md:p-20">
        <h1 className="text-4xl font-medium md:text-6xl">Mento Governance</h1>
        <p className="text-muted-foreground mt-2 max-w-[440px]">
          Participate in the governance process of the Mento Platform.
        </p>
        <div className="mb-8 mt-8 lg:mb-16 lg:mt-16 xl:mb-0">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex flex-row items-center justify-start gap-2">
              Total Proposals
              <Tooltip>
                <TooltipTrigger>
                  <IconInfo />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>
                    The total number of governance proposals submitted to the
                    Mento platform.
                  </p>
                </TooltipContent>
              </Tooltip>
            </span>
            <span className="leading-0 text-lg">11</span>
          </div>
          <hr className="my-3 border-[var(--border)] lg:my-4" />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex flex-row items-center justify-start gap-2">
              Active Proposals
              <Tooltip>
                <TooltipTrigger>
                  <IconInfo />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>
                    The number of governance proposals currently open for voting
                    or under discussion.
                  </p>
                </TooltipContent>
              </Tooltip>
            </span>
            <span className="leading-0 text-lg">3</span>
          </div>
          <hr className="my-3 border-[var(--border)] lg:my-4" />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex flex-row items-center justify-start gap-2">
              Voters
              <Tooltip>
                <TooltipTrigger>
                  <IconInfo />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>
                    The total number of unique addresses that have participated
                    in voting on Mento governance proposals.
                  </p>
                </TooltipContent>
              </Tooltip>
            </span>
            <span className="leading-0 text-lg">2.097K</span>
          </div>
          <hr className="my-3 border-[var(--border)] lg:my-4" />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex flex-row items-center justify-start gap-2">
              Total veMento Voting Power
              <Tooltip>
                <TooltipTrigger>
                  <IconInfo />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>
                    The sum of all veMento tokens, representing the total voting
                    power in the Mento governance system.
                  </p>
                </TooltipContent>
              </Tooltip>
            </span>
            <span className="leading-0 text-lg">120.340K</span>
          </div>
        </div>
      </section>
      <section className="xl:px-22 flex flex-col items-start justify-start gap-12 px-4 lg:flex-row lg:gap-20">
        <div className="flex-grow">
          <ProposalCard>
            <ProposalCardHeader variant="highlighted">
              <h2 className="text-2xl font-semibold">Proposals</h2>
              <Button clipped="lg" size="md">
                Create New Proposal <IconChevron />
              </Button>
            </ProposalCardHeader>
            <ProposalCardBody>
              <ProposalList>
                <ProposalListItem>
                  <ProposalStatus variant="active" />
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalStatus variant="pending" />
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalStatus variant="executed" />
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalStatus variant="queued" />
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalStatus variant="defeated" />
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalStatus />
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalStatus variant="defeated" />
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalStatus variant="defeated" />
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalStatus variant="defeated" />
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalStatus variant="defeated" />
                </ProposalListItem>
              </ProposalList>
            </ProposalCardBody>
            <ProposalCardFooter>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious href="#" />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">1</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">2</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">3</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationEllipsis />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">79</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext href="#" />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </ProposalCardFooter>
          </ProposalCard>
        </div>
        <div className="w-full max-w-xs">
          <div className="bg-card md:max-w-xs">
            <h3 className="bg-incard flex items-center gap-2 px-6 py-5 text-2xl">
              <Zap /> Voting Power
            </h3>
            <div className="flex flex-col gap-4 px-6 pt-6 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">MENTO</span>
                <span>6000</span>
              </div>
              <hr />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">veMENTO</span>
                <span>6000</span>
              </div>
              <hr />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Expires</span>
                <span>{"17.10.2027"}</span>
              </div>
            </div>
            <div className="p-6">
              <Button className="h-10 w-full" clipped="sm">
                Manage
                <ChevronsRight size={20} />
              </Button>
            </div>
          </div>
          <div className="bg-card mt-4 md:max-w-xs">
            <h3 className="bg-incard flex items-center gap-2 px-6 py-5 text-2xl">
              <Zap className="h-6 w-6 fill-current" /> $MENTO
            </h3>
            <div className="flex flex-col gap-4 px-6 pt-6 text-sm">
              {/* <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger>General</AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-col gap-4 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Label</span>
                        <span>Celo Mainnet</span>
                      </div>
                      <hr />
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Supply</span>
                        <span>1,000,000,000</span>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-2">
                  <AccordionTrigger>Parameters</AccordionTrigger>
                  <AccordionContent></AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-3">
                  <AccordionTrigger>Contract Addresses</AccordionTrigger>
                  <AccordionContent></AccordionContent>
                </AccordionItem>
              </Accordion> */}
            </div>
            <div className="p-6">
              <Button className="h-10 w-full" clipped="sm">
                Manage
                <ChevronsRight size={20} />
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="xl:px-22 w-full px-4 md:px-20">
        <CommunityCard
          images={{
            mobile: `${env.NEXT_PUBLIC_STORAGE_URL}/Join Community CTA Mobile-Ry6dyO5vexptUPwsgDaemmhrMO0u8d.png`,
            desktop: `${env.NEXT_PUBLIC_STORAGE_URL}/Join Community CTA-nvhdeikuseiFmjssXcpQhq3aKFq4Ht.png`,
          }}
          buttonHref="http://discord.mento.org"
        />
      </section>
    </main>
  );
}
