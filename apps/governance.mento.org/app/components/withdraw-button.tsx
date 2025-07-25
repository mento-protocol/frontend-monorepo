import { useAvailableToWithdraw } from "@/lib/contracts/locking/useAvailableToWithdraw";
import { useLockInfo } from "@/lib/contracts/locking/useLockInfo";
import { useWithdraw } from "@/lib/contracts/locking/useWithdraw";
import { formatUnitsWithThousandSeparators } from "@/lib/helpers/numbers";
import { Button, toast } from "@repo/ui";
import { Celo, Alfajores } from "@/lib/config/chains";
import React from "react";
import { useAccount } from "wagmi";
import { TxDialog } from "./tx-dialog/tx-dialog";

export const WithdrawButton = () => {
  const { availableToWithdraw, refetchAvailableToWithdraw } =
    useAvailableToWithdraw();

  const { address, chainId } = useAccount();

  const { refetch } = useLockInfo(address);

  const hasAmountToWithdraw = availableToWithdraw > BigInt(0);

  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [modalTitle, setModalTitle] = React.useState("");
  const [modalMessage, setModalMessage] = React.useState<React.ReactNode>(null);

  const handleWithdrawSuccess = React.useCallback(
    (txHash?: `0x${string}`) => {
      // Show success toast with explorer link
      const currentChain = chainId === Celo.id ? Celo : Alfajores;
      const explorerUrl = currentChain.blockExplorers?.default?.url;
      const explorerTxUrl =
        txHash && explorerUrl ? `${explorerUrl}/tx/${txHash}` : null;

      toast.success(
        <>
          Withdrawal successful!
          {explorerTxUrl && (
            <>
              <br />
              <a
                href={explorerTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground underline"
              >
                View Transaction on CeloScan
              </a>
            </>
          )}
        </>,
      );

      setTimeout(() => {
        refetchAvailableToWithdraw();
        refetch();
        setIsModalOpen(false);
      }, 2000);
    },
    [chainId, refetchAvailableToWithdraw, refetch],
  );

  const { withdraw, isPending, isConfirming, error } = useWithdraw({
    onConfirmation: handleWithdrawSuccess,
    onError: (error) => {
      console.error("Withdraw failed", error);
      toast.error("Failed to withdraw");
      // Keep modal open to show error state
    },
  });

  const handleWithdraw = React.useCallback(() => {
    setIsModalOpen(true);
    withdraw();
  }, [withdraw]);

  const closeModal = React.useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const retryWithdraw = React.useCallback(() => {
    withdraw();
  }, [withdraw]);

  React.useEffect(() => {
    if (isPending) {
      setModalTitle("Withdrawing");
      setModalMessage("Please confirm the transaction in your wallet.");
    } else if (isConfirming) {
      setModalTitle("Confirming Withdrawal");
      setModalMessage("Transaction is being confirmed on the blockchain.");
    } else if (error) {
      setModalTitle("Withdrawal Failed");
      setModalMessage("There was an error processing your withdrawal.");
    }
  }, [isPending, isConfirming, error]);

  // Ensure modal opens when transaction starts
  React.useEffect(() => {
    if (isPending || isConfirming) {
      setIsModalOpen(true);
    }
  }, [isPending, isConfirming]);

  return (
    <>
      {hasAmountToWithdraw && !isPending && !isConfirming && (
        <Button
          className="h-12 w-full"
          clipped="default"
          variant="secondary"
          onClick={handleWithdraw}
        >
          Withdraw{" "}
          {formatUnitsWithThousandSeparators(availableToWithdraw, 18, 2)} MENTO
        </Button>
      )}
      <TxDialog
        isOpen={isModalOpen}
        onClose={closeModal}
        error={!!error}
        retry={retryWithdraw}
        title={modalTitle}
        message={modalMessage}
        preventClose={isPending || isConfirming}
        isPending={isPending || isConfirming}
      />
    </>
  );
};
