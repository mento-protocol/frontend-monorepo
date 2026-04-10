export interface LocalStore<T> {
  getSnapshot: () => T;
  set: (nextValue: T) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createLocalStore<T>(initialValue: T): LocalStore<T> {
  let value = initialValue;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => value,
    set: (nextValue) => {
      if (Object.is(value, nextValue)) return;
      value = nextValue;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
