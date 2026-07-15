import { useCallback, type ComponentPropsWithRef, type DetailedHTMLProps, type HTMLAttributes } from "react";

/**
 * Callback form of a React ref that returns a cleanup, matching React 19
 * callback-ref cleanup and Custom Element connect/disconnect lifecycle.
 */
type PresenceRef = (target: HTMLElement) => () => void;

/**
 * Custom Element that re-attaches a presence callback whenever the host is
 * connected / disconnected, or when the callback itself is replaced.
 *
 * React can clear refs without unmounting the host (e.g. Activity hide/show,
 * reparenting). Bridging through connected/disconnected keeps the outer
 * callback-ref lifecycle honest: attach on connect, cleanup on disconnect.
 */
class AutoPresenceElement extends HTMLElement {
  #presenceRef?: PresenceRef;
  #cleanup?: () => void;

  set "presence-ref"(value: PresenceRef | undefined) {
    this.#presenceRef = value;
    if (this.#cleanup) {
      this.#cleanup();
      if (this.isConnected && value) {
        this.#cleanup = value(this);
      } else {
        this.#cleanup = undefined;
      }
    }
  }

  get "presence-ref"() {
    return this.#presenceRef;
  }

  connectedCallback() {
    this.#cleanup = this["presence-ref"]?.(this);
  }

  disconnectedCallback() {
    this.#cleanup?.();
    this.#cleanup = undefined;
  }
}

interface AutoPresenceAttributes extends HTMLAttributes<HTMLElement> {
  "presence-ref"?: (target: HTMLElement) => () => void;
}

/* eslint-disable @typescript-eslint/no-namespace */
declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "auto-presence": DetailedHTMLProps<AutoPresenceAttributes, HTMLElement>;
    }
  }
}

/**
 * Host element whose DOM presence is reported through a React `ref` cleanup.
 *
 * Use when a parent (typically `AutoTransition`) needs a stable attach/detach
 * signal that survives React ref clearing without a true unmount — for example
 * React `<Activity>` hide/show cycles.
 *
 * Renders a Custom Element (`auto-presence`) so connect/disconnect, not React
 * commit alone, owns the ref lifecycle.
 */
export function PresenceHost({ ref, ...props }: ComponentPropsWithRef<"section">) {
  return (
    <auto-presence
      {...props}
      presence-ref={useCallback(
        (target) => {
          if (typeof ref === "function") {
            const cleanup = ref(target);
            if (cleanup) return cleanup;
            return () => ref(null);
          }
          if (ref) {
            ref.current = target;
            return () => {
              ref.current = null;
            };
          }
          return () => {};
        },
        [ref],
      )}
    />
  );
}

if (typeof customElements === "object") {
  customElements.define("auto-presence", AutoPresenceElement);
}
