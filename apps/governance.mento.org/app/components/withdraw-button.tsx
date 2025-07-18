import { useAvailableToWithdraw } from "@/lib/contracts/locking/useAvailableToWithdraw";
import { Button, toast } from "@repo/ui";
import { formatUnits } from "viem";
import React from "react";
import useTokens from "@/lib/contracts/useTokens";
import { useWithdraw } from "@/lib/contracts/locking/useWithdraw";
import { useAccount } from "wagmi";
import { TxDialog } from "./tx-dialog/tx-dialog";
import { useLockInfo } from "@/lib/contracts/locking/useLockInfo";
import { formatUnitsWithThousandSeparators } from "@/lib/helpers/numbers";

export const WithdrawButton = () => {
  const { availableToWithdraw, refetchAvailableToWithdraw } =
    useAvailableToWithdraw();

  const { address } = useAccount();

  const { refetch } = useLockInfo(address);

  const {
    mentoContractData: { decimals: mentoDecimals },
  } = useTokens();

  const hasAmountToWithdraw = availableToWithdraw > BigInt(0);

  const availableToWithdrawFormatted = React.useMemo(() => {
    return Number(formatUnits(availableToWithdraw, mentoDecimals)).toFixed(3);
  }, [availableToWithdraw, mentoDecimals]);

  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [modalTitle, setModalTitle] = React.useState("");
  const [modalMessage, setModalMessage] = React.useState<React.ReactNode>(null);

  const handleWithdrawSuccess = React.useCallback(() => {
    refetchAvailableToWithdraw();
    refetch();
    setIsModalOpen(false);
  }, [refetchAvailableToWithdraw, refetch]);

  const { withdraw, isPending, isConfirming, error } = useWithdraw({
    onConfirmation: handleWithdrawSuccess,
    onError: () => {
      toast.error("Failed to withdraw");
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

  return (
    <>
      {hasAmountToWithdraw && (
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
      />
    </>
  );
};
