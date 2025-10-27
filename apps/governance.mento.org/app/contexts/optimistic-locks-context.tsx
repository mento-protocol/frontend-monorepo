"use client";
import { LockWithExpiration } from "@/contracts/types";
import React, { createContext, useCallback, useContext, useState } from "react";

interface OptimisticLock extends LockWithExpiration {
  isOptimistic: true;
}

interface OptimisticLocksContextValue {
  optimisticLocks: OptimisticLock[];
  addOptimisticLock: (lock: OptimisticLock) => void;
  removeOptimisticLock: (lockId: string) => void;
  clearOptimisticLocks: () => void;
}

const OptimisticLocksContext = createContext<
  OptimisticLocksContextValue | undefined
>(undefined);

export function OptimisticLocksProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [optimisticLocks, setOptimisticLocks] = useState<OptimisticLock[]>([]);

  const addOptimisticLock = useCallback((lock: OptimisticLock) => {
    setOptimisticLocks((prev) => [...prev, lock]);
  }, []);

  const removeOptimisticLock = useCallback((lockId: string) => {
    setOptimisticLocks((prev) => prev.filter((l) => l.lockId !== lockId));
  }, []);

  const clearOptimisticLocks = useCallback(() => {
    setOptimisticLocks([]);
  }, []);

  return (
    <OptimisticLocksContext.Provider
      value={{
        optimisticLocks,
        addOptimisticLock,
        removeOptimisticLock,
        clearOptimisticLocks,
      }}
    >
      {children}
    </OptimisticLocksContext.Provider>
  );
}

export function useOptimisticLocks() {
  const context = useContext(OptimisticLocksContext);
  if (context === undefined) {
    throw new Error(
      "useOptimisticLocks must be used within OptimisticLocksProvider",
    );
  }
  return context;
}

export type { OptimisticLock };
