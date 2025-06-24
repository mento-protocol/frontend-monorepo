import { Button } from "@repo/ui";
import { PlusCircle, Repeat } from "lucide-react";

export function WelcomeBanner() {
  return (
    <div className="rounded-lg bg-gradient-to-r from-purple-500 to-fuchsia-500 p-8 text-white">
      <h1 className="text-3xl font-bold">Welcome to Mento V3</h1>
      <p className="mt-2 max-w-2xl">
        Decentralized borrowing and stability, powered by Celo.
      </p>
      <p className="mt-2 max-w-3xl text-purple-100">
        Leverage your assets by opening a Trove, contribute to system stability
        through redemptions, or help maintain pegs by rebalancing pools.
      </p>
      <div className="mt-6 flex flex-col gap-4 md:flex-row">
        <Button
          variant="secondary"
          className="bg-white/90 text-purple-600 hover:bg-white"
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          Open a Trove
        </Button>
        <Button
          variant="secondary"
          className="bg-white/90 text-purple-600 hover:bg-white"
        >
          <Repeat className="mr-2 h-4 w-4" />
          Rebalance Pools
        </Button>
      </div>
    </div>
  );
}
