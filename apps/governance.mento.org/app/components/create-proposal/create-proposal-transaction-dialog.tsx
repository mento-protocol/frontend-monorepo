import { ITxDialog, TxDialog } from "../tx-dialog/tx-dialog";

interface ICreateProposalDialog extends ITxDialog {
  error?: boolean;
  retry: () => void;
}

export const CreateProposalTxDialog = ({
  isOpen,
  onClose,
  error,
  retry,
  message,
  title,
}: ICreateProposalDialog) => {
  return (
    <TxDialog
      isOpen={isOpen}
      title={title}
      error={error}
      retry={retry}
      onClose={onClose}
      message={message}
    />
  );
};
