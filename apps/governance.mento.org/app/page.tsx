import { env } from "@/env.mjs";
import { Zap } from "lucide-react";
import Image from "next/image";

import { MentoTokenInfo } from "./components/mento-token-info";
import { ProposalList } from "./components/proposal-list";
import { ProposalStats } from "./components/proposal-stats";
import { VotingPowerCard } from "./components/voting-power-card";

export default async function Home() {
  return (
    <main className="pb-4 relative w-full">
      <Image
        src={`${env.NEXT_PUBLIC_STORAGE_URL}/governance/hero.png`}
        alt="Mento Governance"
        width={320}
        height={168}
        className="md:px-22 my-8 lg:hidden w-full"
      />
      <Image
        src={`${env.NEXT_PUBLIC_STORAGE_URL}/governance/hero.png`}
        alt="Mento Governance"
        width={1280}
        height={605}
        className="right-12 top-0 lg:block 2xl:left-auto 2xl:right-20 absolute -bottom-[50px] -z-10 hidden h-[605px] w-auto object-cover"
      />
      <ProposalStats />
      <section className="gap-12 px-4 md:px-20 lg:flex-row lg:gap-20 flex flex-col-reverse items-start justify-start">
        <div className="w-full flex-grow">
          <ProposalList />
        </div>
        <div className="gap-4 xl:max-w-xs xl:gap-2 xl:pt-2 flex w-full flex-col">
          <VotingPowerCard />
          <div className="md:w-full bg-card">
            <h3 className="gap-2 px-6 py-5 text-2xl before:-left-4 before:-top-4 before:h-4 before:w-4 after:-right-4 after:-top-4 after:h-4 after:w-4 xl:before:-left-2 xl:before:-top-2 xl:before:h-2 xl:before:w-2 xl:after:absolute xl:after:-right-2 xl:after:-top-2 xl:after:h-2 xl:after:w-2 relative flex items-center bg-incard before:absolute before:bg-incard after:absolute after:bg-incard">
              <Zap className="h-6 w-6 fill-current" /> $MENTO
            </h3>
            <div className="gap-4 px-6 pt-6 text-sm flex flex-col">
              <MentoTokenInfo />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
