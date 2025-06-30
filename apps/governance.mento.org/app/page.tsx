import { env } from "@/env.mjs";
import { Button, IconChevron } from "@repo/ui";
import { ChevronsRight, Zap } from "lucide-react";
import Image from "next/image";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  ProposalCard,
  ProposalCardBody,
  ProposalCardFooter,
  ProposalCardHeader,
  ProposalList,
  ProposalListItem,
  ProposalListItemBody,
  ProposalListItemIndex,
  ProposalStatus,
} from "@repo/ui";
import { ProposalStats } from "./components/proposal-stats";

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
      <ProposalStats />
      <section className="xl:px-22 flex flex-col items-start justify-start gap-12 px-4 lg:flex-row lg:gap-20">
        <div className="w-full flex-grow">
          <ProposalCard>
            <ProposalCardHeader>
              <h2 className="text-2xl font-semibold">Proposals</h2>
              <Button clipped="lg" size="md">
                Create New Proposal <IconChevron />
              </Button>
            </ProposalCardHeader>
            <ProposalCardBody>
              <ProposalList>
                <ProposalListItem>
                  <ProposalListItemIndex index="1" />
                  <ProposalListItemBody>
                    <ProposalStatus variant="active" />
                    <h3 className="text-xl text-white xl:text-lg">
                      MGP-5: Update voting period ahead of L2 transition
                    </h3>
                    <div className="w-full xl:ml-auto xl:max-w-[192px]">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--approved)]"></span>
                          1.2M
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--rejected)]"></span>
                          320K
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--abstained)]"></span>
                          0
                        </div>
                      </div>
                    </div>
                  </ProposalListItemBody>
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalListItemIndex index="2" />
                  <ProposalListItemBody>
                    <ProposalStatus variant="pending" />
                    <h3 className="text-xl text-white xl:text-lg">
                      MGP-5: Update voting period ahead of L2 transition
                    </h3>
                    <div className="w-full xl:ml-auto xl:max-w-[192px]">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--approved)]"></span>
                          1.2M
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--rejected)]"></span>
                          320K
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--abstained)]"></span>
                          0
                        </div>
                      </div>
                    </div>
                  </ProposalListItemBody>
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalListItemIndex index="3" />
                  <ProposalListItemBody>
                    <ProposalStatus variant="executed" />
                    <h3 className="text-xl text-white xl:text-lg">
                      MGP-5: Update voting period ahead of L2 transition
                    </h3>
                    <div className="w-full xl:ml-auto xl:max-w-[192px]">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--approved)]"></span>
                          1.2M
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--rejected)]"></span>
                          320K
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--abstained)]"></span>
                          0
                        </div>
                      </div>
                    </div>
                  </ProposalListItemBody>
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalListItemIndex index="4" />
                  <ProposalListItemBody>
                    <ProposalStatus variant="queued" />
                    <h3 className="text-xl text-white xl:text-lg">
                      MGP-5: Update voting period ahead of L2 transition
                    </h3>
                    <div className="w-full xl:ml-auto xl:max-w-[192px]">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--approved)]"></span>
                          1.2M
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--rejected)]"></span>
                          320K
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--abstained)]"></span>
                          0
                        </div>
                      </div>
                    </div>
                  </ProposalListItemBody>
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalListItemIndex index="5" />
                  <ProposalListItemBody>
                    <ProposalStatus variant="defeated" />
                    <h3 className="text-xl text-white xl:text-lg">
                      MGP-5: Update voting period ahead of L2 transition
                    </h3>
                    <div className="w-full xl:ml-auto xl:max-w-[192px]">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--approved)]"></span>
                          1.2M
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--rejected)]"></span>
                          320K
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--abstained)]"></span>
                          0
                        </div>
                      </div>
                    </div>
                  </ProposalListItemBody>
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalListItemIndex index="6" />
                  <ProposalListItemBody>
                    <ProposalStatus />
                    <h3 className="text-xl text-white xl:text-lg">
                      MGP-5: Update voting period ahead of L2 transition
                    </h3>
                    <div className="w-full xl:ml-auto xl:max-w-[192px]">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--approved)]"></span>
                          1.2M
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--rejected)]"></span>
                          320K
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--abstained)]"></span>
                          0
                        </div>
                      </div>
                    </div>
                  </ProposalListItemBody>
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalListItemIndex index="7" />
                  <ProposalListItemBody>
                    <ProposalStatus variant="defeated" />
                    <h3 className="text-xl text-white xl:text-lg">
                      MGP-5: Update voting period ahead of L2 transition
                    </h3>
                    <div className="w-full xl:ml-auto xl:max-w-[192px]">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--approved)]"></span>
                          1.2M
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--rejected)]"></span>
                          320K
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--abstained)]"></span>
                          0
                        </div>
                      </div>
                    </div>
                  </ProposalListItemBody>
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalListItemIndex index="8" />
                  <ProposalListItemBody>
                    <ProposalStatus variant="defeated" />
                    <h3 className="text-xl text-white xl:text-lg">
                      MGP-5: Update voting period ahead of L2 transition
                    </h3>
                    <div className="w-full xl:ml-auto xl:max-w-[192px]">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--approved)]"></span>
                          1.2M
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--rejected)]"></span>
                          320K
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--abstained)]"></span>
                          0
                        </div>
                      </div>
                    </div>
                  </ProposalListItemBody>
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalListItemIndex index="9" />
                  <ProposalListItemBody>
                    <ProposalStatus variant="defeated" />
                    <h3 className="text-xl text-white xl:text-lg">
                      MGP-5: Update voting period ahead of L2 transition
                    </h3>
                    <div className="w-full xl:ml-auto xl:max-w-[192px]">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--approved)]"></span>
                          1.2M
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--rejected)]"></span>
                          320K
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--abstained)]"></span>
                          0
                        </div>
                      </div>
                    </div>
                  </ProposalListItemBody>
                </ProposalListItem>
                <ProposalListItem>
                  <ProposalListItemIndex index="10" />
                  <ProposalListItemBody>
                    <ProposalStatus variant="defeated" />
                    <h3 className="text-xl text-white xl:text-lg">
                      MGP-5: Update voting period ahead of L2 transition
                    </h3>
                    <div className="w-full xl:ml-auto xl:max-w-[192px]">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--approved)]"></span>
                          1.2M
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--rejected)]"></span>
                          320K
                        </div>
                        <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                          <span className="block h-1 w-1 bg-[var(--abstained)]"></span>
                          0
                        </div>
                      </div>
                    </div>
                  </ProposalListItemBody>
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
    </main>
  );
}
