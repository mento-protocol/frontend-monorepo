"use client";

import { DebugPopup } from "@repo/ui";
import { EarnView } from "@/components/borrow/earn/earn-view";

export default function EarnPage() {
  const shouldEnableDebug = process.env.NEXT_PUBLIC_ENABLE_DEBUG === "true";

  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      {shouldEnableDebug && <DebugPopup />}
      <EarnView />
    </div>
  );
}
