export function microcache<T, Args extends unknown[]>(create: (...args: Args) => T, cleanup?: (old: T) => void) {
  let cache: T | undefined;
  return (...args: Args) => {
    if (cache) {
      return cache;
    }
    cache = create(...args);
    queueMicrotask(() => {
      const old = cache!;
      cache = undefined;
      cleanup?.(old);
    });
    return cache;
  };
}
