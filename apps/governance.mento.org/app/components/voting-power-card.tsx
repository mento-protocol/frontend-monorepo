"use client";
import { useLockInfo } from "@/lib/contracts/locking/useLockInfo";
import NumbersService from "@/lib/helpers/numbers";
import useTokens from "@/lib/hooks/use-tokens";
import { Button } from "@repo/ui";
import { ChevronsRight, Zap } from "lucide-react";
import Link from "next/link";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";

export const VotingPowerCard = () => {
  const { isConnected } = useAccount();
  const { veMentoBalance, mentoBalance } = useTokens();
  const account = useAccount();

  const { activeLocks } = useLockInfo(account.address);

  return (
    <div className="bg-card w-full">
      <h3 className="bg-incard before:bg-incard after:bg-incard relative flex items-center gap-2 px-6 py-5 text-2xl before:absolute before:-left-4 before:-top-4 before:h-4 before:w-4 after:absolute after:-right-4 after:-top-4 after:h-4 after:w-4 xl:before:-left-2 xl:before:-top-2 xl:before:h-2 xl:before:w-2 xl:after:absolute xl:after:-right-2 xl:after:-top-2 xl:after:h-2 xl:after:w-2">
        <Zap /> Voting Power
      </h3>
      <div className="flex flex-col gap-4 px-6 pt-6 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">MENTO</span>
          <span>
            {NumbersService.parseNumericValue(
              formatUnits(mentoBalance.value, mentoBalance.decimals),
            )}
          </span>
        </div>
        <hr className="border-[var(--border-tertiary)]" />
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">veMENTO</span>
          <span>
            {NumbersService.parseNumericValue(
              formatUnits(veMentoBalance.value, veMentoBalance.decimals),
            )}
          </span>
        </div>
        <hr className="border-[var(--border-tertiary)]" />
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Expires</span>
          <span>{"17.10.2027"}</span>
        </div>
      </div>
      <div className="p-6">
        {isConnected && (
          <Link href="/voting-power">
            <Button className="h-10 w-full" clipped="sm">
              {activeLocks.length > 0 ? "Manage" : "Lock Mento"}
              <ChevronsRight size={20} />
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
};
