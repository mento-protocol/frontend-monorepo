import { Button } from "@repo/ui";
import { getSafeUrl } from "@/config";

interface ProposalCancelButtonProps {
  isWatchdog: boolean;
  hasPendingCancellation: boolean;
  onCancel: () => void;
  isAwaitingCancelSignature: boolean;
  isCancelConfirming: boolean;
  cancelButtonText: string;
  signaturesCollected: number;
  signaturesRequired: number;
  chainId: number;
  watchdogAddress: string;
}

/**
 * Cancel button component for proposals.
 * Shows either a cancel button (for direct cancellation) or a pending cancellation link.
 * Only visible to watchdog signers.
 */
export const ProposalCancelButton = ({
  isWatchdog,
  hasPendingCancellation,
  onCancel,
  isAwaitingCancelSignature,
  isCancelConfirming,
  cancelButtonText,
  signaturesCollected,
  signaturesRequired,
  chainId,
  watchdogAddress,
}: ProposalCancelButtonProps) => {
  if (!isWatchdog) {
    return null;
  }

  if (hasPendingCancellation) {
    return (
      <Button
        variant="outline"
        size="lg"
        clipped="default"
        asChild
        className="w-full"
        data-testid="pendingCancellationButton"
      >
        <a
          href={getSafeUrl(chainId, watchdogAddress)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Cancellation pending — {signaturesCollected}/{signaturesRequired}{" "}
          signatures
        </a>
      </Button>
    );
  }

  return (
    <Button
      variant="reject"
      size="lg"
      clipped="default"
      onClick={onCancel}
      disabled={isAwaitingCancelSignature || isCancelConfirming}
      data-testid="cancelProposalButton"
      className="w-full"
    >
      {cancelButtonText}
    </Button>
  );
};
