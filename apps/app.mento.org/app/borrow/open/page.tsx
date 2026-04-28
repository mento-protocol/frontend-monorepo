import { BorrowView } from "@/components/borrow/borrow-view";
import { OpenTroveForm } from "@/components/borrow/open-trove/open-trove-form";

export default function BorrowOpenPage() {
  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      <BorrowView>
        <OpenTroveForm />
      </BorrowView>
    </div>
  );
}
