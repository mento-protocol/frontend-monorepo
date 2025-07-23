"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  CopyToClipboard,
} from "@repo/ui";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";

import useGovernanceDetails from "@/lib/contracts/governor/useGovernanceDetails";
import { useContracts } from "@/lib/contracts/useContracts";
import useTokens from "@/lib/contracts/useTokens";
import NumbersService from "@/lib/helpers/numbers";

export const MentoTokenInfo = () => {
  const { chain } = useAccount();
  const {
    mentoContractData: { totalSupply, decimals },
  } = useTokens();
  const {
    proposalThreshold,
    quorumNeeded,
    votingPeriodFormatted,
    timeLockFormatted,
  } = useGovernanceDetails();
  const {
    MentoToken: { address: mentoAddress },
    TimelockController: { address: timelockAddress },
    MentoGovernor: { address: governorAddress },
    Locking: { address: lockingAddress },
  } = useContracts();

  const networkLabel = `${chain?.name || "Celo"} ${chain?.testnet ? "Testnet" : "Mainnet"}`;
  const formattedSupply = NumbersService.parseNumericValue(
    formatUnits(totalSupply, decimals),
  );

  return (
    <Accordion
      type="single"
      collapsible
      className="w-full"
      defaultValue="item-1"
    >
      <AccordionItem value="item-1" className="border-none">
        <AccordionTrigger>General</AccordionTrigger>
        <AccordionContent>
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Label</span>
              <span>{networkLabel}</span>
            </div>
            <hr className="border-[var(--border-tertiary)]" />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Supply</span>
              <span>{formattedSupply}</span>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2" className="border-none">
        <AccordionTrigger>Parameters</AccordionTrigger>
        <AccordionContent>
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Proposal threshold</span>
              <span>
                {proposalThreshold
                  ? NumbersService.parseNumericValue(
                      formatUnits(BigInt(proposalThreshold), 18),
                      2,
                    )
                  : "-"}
              </span>
            </div>
            <hr className="border-[var(--border-tertiary)]" />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Quorum needed</span>
              <span>
                {quorumNeeded
                  ? NumbersService.parseNumericValue(
                      formatUnits(quorumNeeded, 18),
                      2,
                    )
                  : "-"}
              </span>
            </div>
            <hr className="border-[var(--border-tertiary)]" />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Voting period</span>
              <span>{votingPeriodFormatted || "-"}</span>
            </div>
            <hr className="border-[var(--border-tertiary)]" />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Timelock</span>
              <span>{timeLockFormatted || "-"}</span>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3" className="border-none">
        <AccordionTrigger>Contract Addresses</AccordionTrigger>
        <AccordionContent>
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Governor</span>
              <ContractAddressDisplay address={governorAddress} />
            </div>
            <hr className="border-[var(--border-tertiary)]" />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">MENTO</span>
              <ContractAddressDisplay address={mentoAddress} />
            </div>
            <hr className="border-[var(--border-tertiary)]" />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Timelock</span>
              <ContractAddressDisplay address={timelockAddress} />
            </div>
            <hr className="border-[var(--border-tertiary)]" />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">veMENTO</span>
              <ContractAddressDisplay address={lockingAddress} />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

const ContractAddressDisplay = ({
  address,
}: {
  address: string | undefined;
}) => {
  if (!address) {
    return <span>-</span>;
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-sm">
        {formatAddress(address)}
      </span>
      <CopyToClipboard text={address} />
    </div>
  );
};
