import { GovernorABI } from "@/lib/abi/Governor";
import { TimelockControllerABI } from "@/lib/abi/TimelockController";
import { useContracts } from "@/lib/contracts/useContracts";
import { useEnsureChainId } from "@/lib/hooks/use-ensure-chain-id";
import { useMemo } from "react";

import { useReadContracts } from "wagmi";

function convertSecondsToDays(
  durationInSeconds: string | bigint | number,
): number {
  const secondsPerDay = 24 * 60 * 60;
  const days = Number(durationInSeconds) / secondsPerDay;
  return Math.floor(days);
}

function convertSecondsToMinutes(
  durationInSeconds: string | bigint | number,
): number {
  const minutes = Number(durationInSeconds) / 60;
  return Math.floor(minutes);
}

function formatParam(
  result: string | number | bigint,
  formatter: (value: string | number | bigint) => string,
) {
  return formatter(result);
}

const useGovernanceDetails = () => {
  const ensuredChainId = useEnsureChainId();
  const { MentoGovernor, TimelockController } = useContracts();

  const governorContact = {
    address: MentoGovernor.address,
    abi: GovernorABI,
  } as const;

  const timeLockContract = {
    address: TimelockController.address,
    abi: TimelockControllerABI,
  } as const;

  const result = useReadContracts({
    contracts: [
      {
        ...governorContact,
        functionName: "votingPeriod",
        chainId: ensuredChainId,
      },
      {
        ...governorContact,
        functionName: "proposalThreshold",
        chainId: ensuredChainId,
      },
      {
        ...governorContact,
        functionName: "quorumVotes",
        chainId: ensuredChainId,
      },
      {
        ...timeLockContract,
        functionName: "getMinDelay",
        chainId: ensuredChainId,
      },
    ],
    allowFailure: false,
  });

  const { votingPeriod, proposalThreshold, quorumNeeded, timeLockDuration } =
    useMemo(() => {
      if (result.data) {
        const [
          votingPeriod,
          proposalThreshold,
          quorumNeeded,
          timeLockDuration,
        ] = result.data;
        return {
          votingPeriod,
          proposalThreshold,
          quorumNeeded,
          timeLockDuration,
        };
      } else {
        return {
          votingPeriod: null,
          proposalThreshold: null,
          quorumNeeded: null,
          timeLockDuration: null,
        };
      }
    }, [result.data]);

  const votingPeriodFormatted = useMemo(() => {
    if (!votingPeriod) return "-";

    return formatParam(votingPeriod, (value) => {
      const votingPeriodInDays = convertSecondsToDays(value);
      if (votingPeriodInDays < 1) {
        return `${convertSecondsToMinutes(value)} minutes`;
      }
      return `${votingPeriodInDays} days`;
    });
  }, [votingPeriod]);

  const timeLockFormatted = useMemo(() => {
    if (!timeLockDuration) return "-";

    return formatParam(timeLockDuration, (value) => {
      const timeLockDurationInDays = convertSecondsToDays(value);
      if (timeLockDurationInDays < 1) {
        return `${convertSecondsToMinutes(value)} minutes`;
      }
      return `${timeLockDurationInDays} days`;
    });
  }, [timeLockDuration]);

  return {
    votingPeriod,
    timeLockDuration,
    proposalThreshold,
    quorumNeeded,
    votingPeriodFormatted,
    timeLockFormatted,
  };
};

export default useGovernanceDetails;
