"use client";

import { DebugPopup } from "@repo/ui";
import { BorrowView } from "@/components/borrow/borrow-view";

export default function BorrowPage() {
  const shouldEnableDebug = process.env.NEXT_PUBLIC_ENABLE_DEBUG === "true";

  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      {shouldEnableDebug && <DebugPopup />}
      <BorrowView />
    </div>
  );
}
