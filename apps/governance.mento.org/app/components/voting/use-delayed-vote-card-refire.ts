import { useEffect } from "react";

interface UseDelayedVoteCardRefireProps {
  isVoteConfirmed: boolean;
  isQueueConfirmed: boolean;
  isProposerCancelConfirmed: boolean;
  refetchVoteReceipt: () => void;
  onVoteConfirmed?: () => void;
}

const scheduleImmediateAndDelayed = (callback: () => void) => {
  callback();

  const timeoutAfterTwoSeconds = setTimeout(() => {
    callback();
  }, 2000);

  const timeoutAfterFiveSeconds = setTimeout(() => {
    callback();
  }, 5000);

  return () => {
    clearTimeout(timeoutAfterTwoSeconds);
    clearTimeout(timeoutAfterFiveSeconds);
  };
};

export const useDelayedVoteCardRefire = ({
  isVoteConfirmed,
  isQueueConfirmed,
  isProposerCancelConfirmed,
  refetchVoteReceipt,
  onVoteConfirmed,
}: UseDelayedVoteCardRefireProps) => {
  useEffect(() => {
    if (!isVoteConfirmed) return;

    const cleanups = [scheduleImmediateAndDelayed(refetchVoteReceipt)];

    if (onVoteConfirmed) {
      cleanups.push(scheduleImmediateAndDelayed(onVoteConfirmed));
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [isVoteConfirmed, refetchVoteReceipt, onVoteConfirmed]);

  useEffect(() => {
    if (!isQueueConfirmed || !onVoteConfirmed) return;

    return scheduleImmediateAndDelayed(onVoteConfirmed);
  }, [isQueueConfirmed, onVoteConfirmed]);

  useEffect(() => {
    if (!isProposerCancelConfirmed || !onVoteConfirmed) return;

    return scheduleImmediateAndDelayed(onVoteConfirmed);
  }, [isProposerCancelConfirmed, onVoteConfirmed]);
};
