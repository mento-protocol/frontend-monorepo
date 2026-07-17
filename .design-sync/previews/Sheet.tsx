import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@mento-protocol/ui";

export const SidePanel = () => (
  <Sheet defaultOpen>
    <SheetContent>
      <SheetHeader>
        <SheetTitle>Transaction details</SheetTitle>
        <SheetDescription>
          Review the details of your pending transaction before signing.
        </SheetDescription>
      </SheetHeader>
    </SheetContent>
  </Sheet>
);
