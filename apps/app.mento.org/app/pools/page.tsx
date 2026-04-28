"use client";

import { Suspense } from "react";
import { PoolsView } from "@/components/pools/pools-view";

export default function PoolsListPage() {
  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      <Suspense>
        <PoolsView />
      </Suspense>
    </div>
  );
}
