import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

export function useIsSsr() {
  return useSyncExternalStore(
    subscribe,
    () => false,
    () => true,
  );
}
