import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  IconLoading,
} from "@repo/ui";

export interface ITxDialog {
  isOpen: boolean;
  error?: boolean;
  retry: () => void;
  message: React.ReactNode;
  title: string;
  onClose: () => void;
  dataTestId?: string;
  preventClose?: boolean;
  isPending?: boolean;
}

export const TxDialog = ({
  isOpen,
  error,
  message,
  retry,
  title,
  onClose,
  dataTestId,
  preventClose = false,
  isPending = false,
}: ITxDialog) => {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) =>
        !open && !(preventClose || isPending) && onClose()
      }
      data-testid={dataTestId}
    >
      <DialogContent
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) =>
          (preventClose || isPending) && e.preventDefault()
        }
      >
        <DialogHeader>
          <DialogTitle className="text-center">{title}</DialogTitle>
        </DialogHeader>
        <div className="text-muted-foreground mt-2 text-center text-sm">
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
  return <p>Transaction was rejected.</p>;
};

const PendingMessage = ({ message }: { message: React.ReactNode }) => {
  return (
    <>
      {message}
      <IconLoading className="mx-auto my-8" />
    </>
  );
};
