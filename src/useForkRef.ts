import { useCallback, type Ref } from "react";

export function useForkRef<T>(...refs: (Ref<T> | null | undefined)[]): (node: T | null) => void {
  return useCallback((node: T | null) => {
    refs.forEach((ref) => {
      if (ref) {
        if (typeof ref === "function") {
          ref(node);
        } else if (ref.current !== undefined) {
          ref.current = node;
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, refs);
}
