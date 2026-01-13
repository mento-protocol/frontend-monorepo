export function EmptyExecutionMessage() {
  return (
    <div className="gap-3 p-4 flex items-center rounded-lg bg-muted/50">
      <div className="h-8 w-8 bg-blue-500/10 flex items-center justify-center rounded-full">
        <span className="text-blue-500">ℹ</span>
      </div>
      <div>
        <p className="font-medium text-foreground">
          This is an informational proposal only
        </p>
        <p className="text-sm text-muted-foreground">
          No on-chain actions will be executed if this proposal passes.
        </p>
      </div>
    </div>
  );
}
