import { IconLoading } from "@repo/ui";

export function LoadingState() {
  return (
    <div className="flex items-center gap-3">
      <IconLoading className="h-4 w-4" />
      <span className="text-muted-foreground">Decoding transactions...</span>
    </div>
  );
}
