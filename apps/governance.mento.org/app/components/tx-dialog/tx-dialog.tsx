import { Button } from "@repo/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@repo/ui";
import { Loader } from "lucide-react";

export interface ITxDialog {
  isOpen: boolean;
  error?: boolean;
  retry: () => void;
  message: React.ReactNode;
  title: string;
  onClose: () => void;
}

export const TxDialog = ({
  isOpen,
  error,
  message,
  retry,
  title,
  onClose,
}: ITxDialog) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="mt-2">
          {error ? <ErrorMessage /> : <PendingMessage message={message} />}
        </div>
        {error && (
          <div className="mt-4 flex flex-row justify-center gap-2">
            <Button variant="outline" onClick={onClose}>
              Back
            </Button>
            <Button onClick={retry}>Retry</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const ErrorMessage = () => {
  return (
    <>
      <p className="text-error dark:text-error-light text-center text-lg">
        Transaction was rejected.
      </p>
    </>
  );
};

const PendingMessage = ({ message }: { message: React.ReactNode }) => {
  return (
    <>
      <div className="text-primary-dark text-lg dark:text-white">{message}</div>
      <Loader className="mx-auto my-8" />
    </>
  );
};
