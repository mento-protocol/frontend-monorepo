"use client";

import { useSanctionsCheck } from "@/hooks/use-sanctions-check";
import { Button } from "@repo/ui";
import { ShieldX } from "lucide-react";
import type { PropsWithChildren } from "react";

export function SanctionsGuard({ children }: PropsWithChildren) {
  const { isSanctioned, checkFailed } = useSanctionsCheck();

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
          <Button size="sm" onClick={() => window.location.reload()}>
            Retry
          </Button>
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
