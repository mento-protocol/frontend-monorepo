export function LoadingState() {
  return (
    <div className="flex items-center gap-3">
      <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"></div>
      <span className="text-muted-foreground">Decoding transactions...</span>
    </div>
  );
}
