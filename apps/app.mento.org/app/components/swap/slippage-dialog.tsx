import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui";

import { formValuesAtom } from "@/features/swap/swap-atoms";
import { useAtomValue } from "jotai";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import NewSlippageForm from "./slippage-form";

export function SlippageDialog() {
  const [open, setOpen] = useState(false);
  const formValues = useAtomValue(formValuesAtom);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 p-2 text-base">
          <SlidersHorizontal
            className="text-muted-foreground h-5 w-5"
            size={20}
          />
          {formValues?.slippage}%
        </Button>
      </DialogTrigger>
      <DialogContent className="!max-w-xl">
        <DialogHeader>
          <DialogTitle>Slippage Tolerance</DialogTitle>
          <DialogDescription>
            Defines the maximum price difference you&apos;re willing to accept
            when a swap is executed. It&apos;s set as a percentage of the total
            swap value.
          </DialogDescription>
        </DialogHeader>
        <NewSlippageForm onSubmit={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
