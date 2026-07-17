import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from "@mento-protocol/ui";

export const ConfirmDialog = () => (
  <Dialog defaultOpen>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Confirm swap</DialogTitle>
        <DialogDescription>
          You are swapping 100 CELO for 64.20 USDm. This action cannot be
          undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" clipped="default">
          Cancel
        </Button>
        <Button clipped="default">Confirm</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
