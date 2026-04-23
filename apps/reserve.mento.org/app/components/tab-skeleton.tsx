import { Skeleton } from "@repo/ui";

export function TabSkeleton() {
  return (
    <div className="gap-4 flex flex-col">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
