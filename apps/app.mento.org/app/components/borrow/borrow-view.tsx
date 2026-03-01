"use client";

export function BorrowView() {
  return (
    <div className="max-w-5xl space-y-6 px-4 pt-6 md:px-0 md:pt-0 mb-6 min-h-[550px] w-full">
      <div className="relative">
        <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
        <div className="p-6 bg-card">
          <h1 className="font-medium md:text-2xl">Borrow</h1>
          <p className="text-sm text-muted-foreground">
            Borrow stablecoins against your collateral.
          </p>
        </div>
      </div>
    </div>
  );
}
