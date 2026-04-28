import { BorrowView } from "@/components/borrow/borrow-view";
import { BorrowDashboard } from "@/components/borrow/dashboard/borrow-dashboard";

export default function BorrowPage() {
  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      <BorrowView showHeader>
        <BorrowDashboard />
      </BorrowView>
    </div>
  );
}
