"use client";

import { useSanctionsCheck } from "@/hooks/use-sanctions-check";
import { ShieldX } from "lucide-react";
import type { PropsWithChildren } from "react";

export function SanctionsGuard({ children }: PropsWithChildren) {
  const { isSanctioned, isChecking, checkFailed } = useSanctionsCheck();

  if (isSanctioned || checkFailed) {
    const heading = isSanctioned
      ? "Access Restricted"
      : "Verification unavailable";
    const message = isSanctioned
      ? "This address has been identified on a sanctions list and is unable to access this application. If you believe this is an error, please contact support."
      : "We couldn't complete the compliance check for this address. Please try again later.";

    return (
      <div className="p-8 flex min-h-screen items-center justify-center bg-background">
        <div className="max-w-md gap-6 flex flex-col items-center text-center">
          <ShieldX className="h-16 w-16 text-destructive" />
          <h1 className="text-2xl font-semibold text-foreground">{heading}</h1>
          <p className="text-muted-foreground">{message}</p>
        </div>
      </div>
    );
  }

  if (isChecking) {
    return (
      <div className="p-8 flex min-h-screen items-center justify-center bg-background">
        <div className="h-16 w-16 animate-pulse rounded-full bg-muted" />
      </div>
    );
  }

  return children;
}
