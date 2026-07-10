import { ProposalCancelButton } from "@/components/voting/proposal-cancel-button";
import { Button } from "@repo/ui";

interface WatchdogCancelActionProps {
  isWatchdog: boolean;
  hasPendingCancellation: boolean;
  isPendingCancellationStatusUnavailable: boolean;
  onCancel: () => void;
  isAwaitingCancelSignature: boolean;
  isCancelConfirming: boolean;
  cancelButtonText: string;
  signaturesCollected: number;
  signaturesRequired: number;
  chainId: number;
  watchdogAddress: string;
}

interface ProposerCancelActionProps {
  canProposerCancel: boolean;
  onCancel: () => void;
  isAwaitingProposerCancelSignature: boolean;
  isProposerCancelConfirming: boolean;
  isProposerCancelConfirmed: boolean;
}

interface VoteCardCancelActionsProps {
  watchdogCancelAction?: WatchdogCancelActionProps;
  proposerCancelAction?: ProposerCancelActionProps;
}

export const VoteCardCancelActions = ({
  watchdogCancelAction,
  proposerCancelAction,
}: VoteCardCancelActionsProps) => {
  return (
    <>
      {watchdogCancelAction && (
        <ProposalCancelButton
          isWatchdog={watchdogCancelAction.isWatchdog}
          hasPendingCancellation={watchdogCancelAction.hasPendingCancellation}
          isPendingCancellationStatusUnavailable={
            watchdogCancelAction.isPendingCancellationStatusUnavailable
          }
          onCancel={watchdogCancelAction.onCancel}
          isAwaitingCancelSignature={
            watchdogCancelAction.isAwaitingCancelSignature
          }
          isCancelConfirming={watchdogCancelAction.isCancelConfirming}
          cancelButtonText={watchdogCancelAction.cancelButtonText}
          signaturesCollected={watchdogCancelAction.signaturesCollected}
          signaturesRequired={watchdogCancelAction.signaturesRequired}
          chainId={watchdogCancelAction.chainId}
          watchdogAddress={watchdogCancelAction.watchdogAddress}
        />
      )}
      {proposerCancelAction?.canProposerCancel && (
        <Button
          variant="reject"
          size="lg"
          clipped="default"
          onClick={proposerCancelAction.onCancel}
          disabled={
            proposerCancelAction.isAwaitingProposerCancelSignature ||
            proposerCancelAction.isProposerCancelConfirming ||
            proposerCancelAction.isProposerCancelConfirmed
          }
          className="mt-4 w-full"
        >
          {proposerCancelAction.isAwaitingProposerCancelSignature
            ? "Confirm in Wallet"
            : proposerCancelAction.isProposerCancelConfirming ||
                proposerCancelAction.isProposerCancelConfirmed
              ? "Cancelling..."
              : "Cancel Proposal"}
        </Button>
      )}
    </>
  );
};
