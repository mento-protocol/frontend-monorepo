import { TransactionLink } from "@/components/proposal/components/TransactionLink";
import { VoteCardState } from "@/components/voting/derive-vote-card-state";
import { Button, IconLoading } from "@repo/ui";

interface VoteCardSpecialContentProps {
  currentState: VoteCardState;
  isAwaitingExecuteSignature: boolean;
  isAwaitingQueueSignature: boolean;
  isExecuteConfirming: boolean;
  isQueueConfirming: boolean;
  voteSupport: number | undefined;
  currentTxHash: string | undefined;
  hash: string | undefined;
  executeHash: string | undefined;
  queueHash: string | undefined;
}

const getLoadingText = ({
  currentState,
  isAwaitingExecuteSignature,
  isAwaitingQueueSignature,
  isExecuteConfirming,
  isQueueConfirming,
}: Omit<
  VoteCardSpecialContentProps,
  "voteSupport" | "currentTxHash" | "hash" | "executeHash" | "queueHash"
>) => {
  switch (currentState) {
    case "loading":
      return "Loading voting information...";
    case "signing":
      if (isAwaitingExecuteSignature) {
        return "Waiting for execution confirmation...";
      }
      if (isAwaitingQueueSignature) {
        return "Waiting for queue confirmation...";
      }
      return "Waiting for confirmation...";
    case "confirming":
      if (isExecuteConfirming) {
        return "Proposal is being executed";
      }
      if (isQueueConfirming) {
        return "Proposal is being queued";
      }
      return "Your vote is being processed";
    default:
      return "";
  }
};

export const VoteCardSpecialContent = ({
  currentState,
  isAwaitingExecuteSignature,
  isAwaitingQueueSignature,
  isExecuteConfirming,
  isQueueConfirming,
  voteSupport,
  currentTxHash,
  hash,
  executeHash,
  queueHash,
}: VoteCardSpecialContentProps) => {
  const loadingStates = ["loading", "signing", "confirming"];

  if (!loadingStates.includes(currentState)) {
    return null;
  }

  return (
    <div className="gap-4 flex flex-col items-center">
      <IconLoading />
      <p
        className="text-muted-foreground"
        data-testid={
          currentState === "signing" && "waitingForConfirmationLabel"
        }
      >
        {getLoadingText({
          currentState,
          isAwaitingExecuteSignature,
          isAwaitingQueueSignature,
          isExecuteConfirming,
          isQueueConfirming,
        })}
      </p>
      {currentState === "signing" &&
        !isAwaitingExecuteSignature &&
        !isAwaitingQueueSignature && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="waitingForConfirmationDescriptionLabel"
          >
            You are voting{" "}
            {voteSupport === 1 ? "YES" : voteSupport === 0 ? "NO" : "ABSTAIN"}{" "}
            on this proposal
          </p>
        )}
      {currentState === "signing" && isAwaitingExecuteSignature && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="waitingForExecutionDescriptionLabel"
        >
          You are executing this proposal
        </p>
      )}
      {currentState === "signing" && isAwaitingQueueSignature && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="waitingForQueueDescriptionLabel"
        >
          You are queueing this proposal for execution
        </p>
      )}
      {currentState === "confirming" &&
        currentTxHash &&
        (hash || executeHash || queueHash) && (
          <Button variant="outline" size="sm" asChild className="mt-2">
            <TransactionLink txHash={currentTxHash}>
              View on explorer
            </TransactionLink>
          </Button>
        )}
    </div>
  );
};
