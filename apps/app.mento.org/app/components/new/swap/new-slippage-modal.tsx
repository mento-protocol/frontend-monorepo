import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui";

import { SlidersHorizontal } from "lucide-react";
import NewSlippageForm from "./new-slippage-form";
import { useState } from "react";
import { useAtomValue } from "jotai";
import { slippageAtom } from "@/features/swap/swap-atoms";

export function SlippageModal() {
  const [open, setOpen] = useState(false);
  const slippage = useAtomValue(slippageAtom);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal />
          {slippage}%
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Slippage Tolerance</DialogTitle>
          <DialogDescription>
            Defines the maximum price difference you're willing to accept when a
            swap is executed. It’s set as a percentage of the total swap value.
          </DialogDescription>
        </DialogHeader>
        <NewSlippageForm onSubmit={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
