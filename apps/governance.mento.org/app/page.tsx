import { env } from "@/env.mjs";
import { Button } from "@repo/ui";
import { ChevronsRight, Zap } from "lucide-react";
import Image from "next/image";

import { ProposalList } from "./components/proposal-list";
import { ProposalStats } from "./components/proposal-stats";
import { VotingPowerCard } from "./components/voting-power-card";
import { MentoTokenInfo } from "./components/mento-token-info";

export default async function Home() {
  return (
    <main className="relative w-full pb-4">
      <Image
        src={`${env.NEXT_PUBLIC_STORAGE_URL}/hero-dhs5Gb3LHWTZgUR0vYoPB13ozvOpfx.png`}
        alt="Mento Reserve"
        width={320}
        height={168}
        className="my-8 w-full lg:hidden md:px-22"
      />
      <Image
        src={`${env.NEXT_PUBLIC_STORAGE_URL}/hero-dhs5Gb3LHWTZgUR0vYoPB13ozvOpfx.png`}
        alt="Mento Reserve"
        width={1280}
        height={605}
        className="absolute -bottom-[50px] right-12 top-0 -z-10 hidden h-[605px] w-auto object-cover lg:block 2xl:left-auto 2xl:right-20"
      />
      <ProposalStats />
      <section className="md:px-20 flex flex-col-reverse items-start justify-start gap-12 px-4 lg:flex-row lg:gap-20">
        <div className="w-full flex-grow">
          <ProposalList />
        </div>
        <div className="w-full flex flex-col gap-4 xl:max-w-xs">
          <VotingPowerCard />
          <div className="bg-card md:w-full">
            <h3 className="bg-incard flex items-center gap-2 px-6 py-5 text-2xl">
              <Zap className="h-6 w-6 fill-current" /> $MENTO
            </h3>
            <div className="flex flex-col gap-4 px-6 pt-6 text-sm">
              <MentoTokenInfo />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
