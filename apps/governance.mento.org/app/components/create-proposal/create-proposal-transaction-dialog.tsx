import { ITxDialog, TxDialog } from "../tx-dialog/tx-dialog";

interface ICreateProposalDialog extends ITxDialog {
  error?: boolean;
  retry: () => void;
  dataTestId?: string;
}

export const CreateProposalTxDialog = ({
  isOpen,
  onClose,
  error,
  retry,
  message,
  title,
  dataTestId,
}: ICreateProposalDialog) => {
  return (
    <TxDialog
      isOpen={isOpen}
      title={title}
      error={error}
      retry={retry}
      onClose={onClose}
      message={message}
      dataTestId={dataTestId}
    />
  );
};
