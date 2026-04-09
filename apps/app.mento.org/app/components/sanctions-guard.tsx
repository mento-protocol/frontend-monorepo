"use client";

import { useSanctionsCheck } from "@/hooks/use-sanctions-check";
import { ShieldX } from "lucide-react";
import type { PropsWithChildren } from "react";

export function SanctionsGuard({ children }: PropsWithChildren) {
  const { isSanctioned, isChecking, checkFailed } = useSanctionsCheck();

  if (isChecking) return null;

  if (checkFailed) {
    return (
      <div className="p-8 flex min-h-screen items-center justify-center bg-background">
        <div className="max-w-md gap-6 flex flex-col items-center text-center">
          <ShieldX className="h-16 w-16 text-muted-foreground" />
          <h1 className="text-2xl font-semibold text-foreground">
            Compliance Check Unavailable
          </h1>
          <p className="text-muted-foreground">
            We are unable to verify your wallet at this time. Please try again
            later.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isSanctioned) {
    return (
      <div className="p-8 flex min-h-screen items-center justify-center bg-background">
        <div className="max-w-md gap-6 flex flex-col items-center text-center">
          <ShieldX className="h-16 w-16 text-destructive" />
          <h1 className="text-2xl font-semibold text-foreground">
            Access Restricted
          </h1>
          <p className="text-muted-foreground">
            This address has been identified on a sanctions list and is unable
            to access this application. If you believe this is an error, please
            contact support.
          </p>
        </div>
      </div>
    );
  }

  return children;
}
