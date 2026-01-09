import { IconLoading } from "@repo/ui";

export function LoadingState() {
  return (
    <div className="gap-3 flex items-center">
      <IconLoading className="h-4 w-4" />
      <span className="text-muted-foreground">Decoding transactions...</span>
    </div>
  );
}
