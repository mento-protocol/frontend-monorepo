import { env } from "@/env.mjs";
import { Zap } from "lucide-react";
import Image from "next/image";

import { MentoTokenInfo } from "./components/mento-token-info";
import { ProposalList } from "./components/proposal-list";
import { ProposalStats } from "./components/proposal-stats";
import { VotingPowerCard } from "./components/voting-power-card";

export default async function Home() {
  return (
    <main className="relative w-full pb-4">
      <Image
        src={`${env.NEXT_PUBLIC_STORAGE_URL}/hero-dhs5Gb3LHWTZgUR0vYoPB13ozvOpfx.png`}
        alt="Mento Reserve"
        width={320}
        height={168}
        className="md:px-22 my-8 w-full lg:hidden"
      />
      <Image
        src={`${env.NEXT_PUBLIC_STORAGE_URL}/hero-dhs5Gb3LHWTZgUR0vYoPB13ozvOpfx.png`}
        alt="Mento Reserve"
        width={1280}
        height={605}
        className="absolute -bottom-[50px] right-12 top-0 -z-10 hidden h-[605px] w-auto object-cover lg:block 2xl:left-auto 2xl:right-20"
      />
      <ProposalStats />
      <section className="flex flex-col-reverse items-start justify-start gap-12 px-4 md:px-20 lg:flex-row lg:gap-20">
        <div className="w-full flex-grow">
          <ProposalList />
        </div>
        <div className="flex w-full flex-col gap-4 xl:max-w-xs xl:gap-2 xl:pt-2">
          <VotingPowerCard />
          <div className="bg-card md:w-full">
            <h3 className="bg-incard before:bg-incard after:bg-incard relative flex items-center gap-2 px-6 py-5 text-2xl before:absolute before:-left-4 before:-top-4 before:h-4 before:w-4 after:absolute after:-right-4 after:-top-4 after:h-4 after:w-4 xl:before:-left-2 xl:before:-top-2 xl:before:h-2 xl:before:w-2 xl:after:absolute xl:after:-right-2 xl:after:-top-2 xl:after:h-2 xl:after:w-2">
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
