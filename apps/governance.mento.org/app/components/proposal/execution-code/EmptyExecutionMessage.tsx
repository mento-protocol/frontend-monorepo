export function EmptyExecutionMessage() {
  return (
    <div className="bg-muted/50 flex items-center gap-3 rounded-lg p-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10">
        <span className="text-blue-500">ℹ</span>
      </div>
      <div>
        <p className="text-foreground font-medium">
          This is an informational proposal
        </p>
        <p className="text-muted-foreground text-sm">
          No on-chain actions will be executed if this proposal passes.
        </p>
      </div>
    </div>
  );
}
