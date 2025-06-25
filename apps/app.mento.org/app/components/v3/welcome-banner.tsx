"use client";

import { Button } from "@repo/ui";
import { PlusCircle, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";

export function WelcomeBanner() {
  const router = useRouter();

  return (
    <div className="rounded-lg bg-gray-900 p-8 text-white md:p-16">
      <h1 className="text-3xl tracking-tight sm:text-4xl">
        Welcome to Mento V3
      </h1>
      <p className="text-md mt-6 max-w-3xl leading-6 text-gray-300 sm:text-lg">
        Decentralized borrowing and stability, powered by Celo. Leverage your
        assets by opening a Trove, contribute to system stability through
        redemptions, or help maintain pegs by rebalancing pools.
      </p>
      <div className="mt-10 flex flex-col gap-4 md:flex-row">
        <Button
          variant="secondary"
          className="bg-white/90 text-slate-800 hover:bg-white"
          onClick={() => router.push("/v3/trove")}
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          Open a Trove
        </Button>
        <Button
          variant="secondary"
          className="bg-white/90 text-slate-800 hover:bg-white"
          onClick={() => router.push("/v3/pools")}
        >
          <Repeat className="mr-2 h-4 w-4" />
          Rebalance Pools
        </Button>
      </div>
    </div>
  );
}
