"use client";

import { ReactNode } from "react";

export function TokenSelectFieldWrapper({ children }: { children: ReactNode }) {
  return (
    <div className="border-primary-dark flex items-center justify-between rounded-xl border bg-white py-[5px] pl-[5px] pr-[20px] dark:border-[#333336] dark:bg-[#1D1D20]">
      {children}
    </div>
  );
}
