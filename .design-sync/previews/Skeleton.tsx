import { Skeleton } from "@mento-protocol/ui";

export const LoadingRows = () => (
  <div
    style={{ display: "flex", flexDirection: "column", gap: 12, width: 240 }}
  >
    <Skeleton className="h-12 w-12 rounded-full" />
    <Skeleton className="h-4 w-3/4" />
    <Skeleton className="h-4 w-1/2" />
  </div>
);

export const TokenRowLoading = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, width: 240 }}>
    <Skeleton className="h-12 w-12 rounded-full" />
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        flex: 1,
      }}
    >
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  </div>
);
