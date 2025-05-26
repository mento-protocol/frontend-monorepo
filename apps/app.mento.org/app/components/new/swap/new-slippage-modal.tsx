import { Copy } from "lucide-react";

import { Button } from "@repo/ui";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui";
import { Input } from "@repo/ui";
import { Label } from "@repo/ui";

import { SlidersHorizontal } from "lucide-react";
import NewSlippageForm from "./new-slippage-form";

export function NewSlippageModal() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal />
          0.25%
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
        <NewSlippageForm />
      </DialogContent>
    </Dialog>
  );
}
