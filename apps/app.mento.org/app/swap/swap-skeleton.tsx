import { Skeleton } from "@repo/ui";

export function SwapSkeleton() {
  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      <div className="mb-6 px-4 md:px-0 relative w-full max-w-[568px]">
        <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
        <div className="space-y-6 p-6 relative z-50 flex min-h-[525px] flex-col bg-card">
          {/* Header */}
          <div className="flex flex-row items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-8 w-8" />
          </div>

          {/* Token inputs */}
          <div className="gap-0 flex flex-col">
            <Skeleton className="h-[120px] w-full" />
            <div className="flex w-full items-center justify-center">
              <Skeleton className="h-10 w-10" />
            </div>
            <Skeleton className="h-[120px] w-full" />
          </div>

          {/* Rate */}
          <Skeleton className="h-5 w-48" />

          {/* Button */}
          <Skeleton className="h-12 mt-auto w-full" />
        </div>
        <div className="bottom-decorations after:-bottom-15 before:-bottom-5 before:-right-5 before:h-5 before:w-5 after:right-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-card before:invert after:absolute after:block after:bg-card"></div>
      </div>
    </div>
  );
}
