import { Slot } from "@radix-ui/react-slot";
import {
  useEffect,
  useRef,
  type ComponentProps,
  type ComponentPropsWithoutRef,
  type ElementType,
  type FC,
  type ForwardedRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { microcache } from "./microcache.ts";
import { useForkRef } from "./useForkRef.ts";
import { patchActivity } from "./ActivityPatch.tsx";

/**
 * A rectangle describing an element's position and size relative to the measured
 * parent used by `AutoTransition` for layout calculations.
 *
 * - `x`/`y` are the left/top offsets relative to the measurement parent's content box.
 * - `width`/`height` are the element's layout size in pixels.
 */
export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Simple size pair used for resize transitions (width/height in pixels).
 */
export type Dimensions = {
  width: number;
  height: number;
};

/**
 * Common props for `AutoTransition`.
 *
 * @template T - Element type to render as (e.g., "div", "ul").
 */
type AutoTransitionBaseProps<T extends ElementType | undefined> = {
  as?: T;
  transition?: TransitionPlugin;
  patch?: boolean;
  ref?: ForwardedRef<HTMLElement>;
};

export type AutoTransitionProps<T extends ElementType | undefined> = T extends ElementType
  ? AutoTransitionBaseProps<T> &
      Omit<ComponentPropsWithoutRef<T>, keyof AutoTransitionBaseProps<T>> & {
        children?: ReactNode;
      }
  : AutoTransitionBaseProps<T> & {
      children: ReactElement;
    };

/**
 * AutoTransition
 *
 * A small container component that provides automatic enter/exit/move
 * animations for its child `Element` nodes. The component intercepts
 * low-level DOM operations (`appendChild`, `insertBefore`, `removeChild`)
 * performed on the container and plays animations (via the Web Animations
 * API) before applying DOM changes such as removing an element.
 *
 * If a `transition` plugin is not provided, AutoTransition applies its
 * default animations:
 *  - enter: fade in (opacity 0 -> 1), 250ms ease-out
 *  - exit: keep element size and position while fading out, 250ms ease-in
 *  - move: translate + scale from previous rect to new rect, 250ms ease-in
 *
 * Notes:
 *  - This component is client-only (relies on DOM measurement & Web Animations API).
 *  - It only animates `Element` nodes; text nodes use native DOM operations.
 *  - In exit path, the provided animation's finish triggers removal from the DOM.
 *
 * Example usage:
 * ```tsx
 * <AutoTransition as="div" className="grid gap-2">
 *   {items.map((it) => (
 *     <Card key={it.id}>{it.title}</Card>
 *   ))}
 * </AutoTransition>
 *
 * // with custom transition plugin
 * <AutoTransition transition={FloatingPanelTransition} as="div">
 *   {isOpen && <PanelContent/>}
 * </AutoTransition>
 * ```
 *
 * @template T - Element type to render as (e.g. "div")
 * @param props - props as defined by `AutoTransitionProps<T>`
 */
export function AutoTransition<T extends ElementType | undefined>({
  as,
  children,
  transition,
  ref: externalRef,
  patch,
  ...rest
}: AutoTransitionProps<T>) {
  const Component = as ?? Slot;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const removed = new Set<Element>();
    const target = ref.current!;
    if (patch) {
      patchActivity(target);
    }
    let measureTarget = target;
    let styles = getComputedStyle(measureTarget);
    while (styles.display === "contents" || (styles.position === "static" && measureTarget !== document.body)) {
      measureTarget = measureTarget.parentElement!;
      styles = getComputedStyle(measureTarget);
    }
    const parentRect = microcache(() => {
      const borderBox = measureTarget.getBoundingClientRect();
      return {
        left: borderBox.left + parseFloat(styles.borderLeftWidth || "0"),
        top: borderBox.top + parseFloat(styles.borderTopWidth || "0"),
      };
    });
    const snapshot = microcache(
      () => {
        const parent = parentRect();
        const result = new Map<Element, Rect>();
        for (const child of target.children) {
          if (child instanceof Element) {
            const rect = child.getBoundingClientRect();
            result.set(child, {
              x: rect.left - parent.left,
              y: rect.top - parent.top,
              width: rect.width,
              height: rect.height,
            });
          }
        }
        return result;
      },
      (old) => {
        for (const child of target.children) {
          if (child instanceof Element) {
            if (removed.has(child)) continue;
            const rect = getRelativePosition(child);
            const oldRect = old.get(child);
            if (!oldRect) continue;
            if (
              rect.x !== oldRect.x ||
              rect.y !== oldRect.y ||
              rect.width !== oldRect.width ||
              rect.height !== oldRect.height
            ) {
              animateNodeMove(child, rect, oldRect);
            }
          }
        }
      },
    );
    target.removeChild = function removeChild<T extends Node>(node: T) {
      if (node instanceof Element) {
        if (removed.has(node)) return node;
        removed.add(node);
        const rect = snapshot().get(node) ?? getRelativePosition(node);
        animateNodeExit(node, rect);
        return node;
      }
      return Element.prototype.removeChild.call(this, node) as T;
    };
    target.insertBefore = function insertBefore<T extends Node>(node: T, child: Node | null) {
      snapshot();
      if (!(node instanceof Element)) {
        return Element.prototype.insertBefore.call(this, node, child) as T;
      }
      Element.prototype.insertBefore.call(this, node, child);
      animateNodeEnter(node);
      return node;
    };
    target.appendChild = function appendChild<T extends Node>(node: T) {
      snapshot();
      if (!(node instanceof Element)) {
        return Element.prototype.appendChild.call(this, node) as T;
      }
      Element.prototype.appendChild.call(this, node);
      animateNodeEnter(node);
      return node;
    };
    return () => {
      target.removeChild = Element.prototype.removeChild;
      target.insertBefore = Element.prototype.insertBefore;
      target.appendChild = Element.prototype.appendChild;
    };

    function animateNodeExit(node: Element, rect: Rect) {
      let animation: Animation;
      if (transition?.exit) {
        animation = transition.exit(node, rect);
      } else {
        const width = `${rect.width}px`;
        const height = `${rect.height}px`;
        const translate = `translate(${rect.x}px, ${rect.y}px)`;
        animation = node.animate(
          {
            position: ["absolute", "absolute"],
            opacity: [1, 0],
            top: ["0", "0"],
            left: ["0", "0"],
            transform: [translate, translate],
            width: [width, width],
            height: [height, height],
            margin: ["0", "0"],
          },
          { duration: 250, easing: "ease-in" },
        );
      }
      animation.finished.then(() => node.remove());
      return animation;
    }

    function animateNodeEnter(node: Element) {
      if (transition?.enter) {
        transition.enter(node);
      } else {
        node.animate({ opacity: [0, 1] }, { duration: 250, easing: "ease-out" });
      }
    }

    function animateNodeMove(node: Element, rect: Rect, oldRect: Rect) {
      if (transition?.move) {
        transition.move(node, rect, oldRect);
      } else {
        const dx = oldRect.x - rect.x;
        const dy = oldRect.y - rect.y;
        const sx = oldRect.width / rect.width;
        const sy = oldRect.height / rect.height;
        node.animate(
          {
            transformOrigin: ["0 0", "0 0"],
            transform: [`translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, `translate(0, 0) scale(1, 1)`],
          },
          { duration: 250, easing: "ease-in" },
        );
      }
    }

    function getRelativePosition(node: Element, parent = parentRect()): Rect {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.left - parent.left,
        y: rect.top - parent.top,
        width: rect.width,
        height: rect.height,
      };
    }
  }, [patch, transition]);
  const forkedRef = useForkRef(ref, externalRef);
  return (
    <Component ref={forkedRef} {...rest}>
      {children}
    </Component>
  );
}

/**
 * A plugin interface to provide custom animations for enter/exit/move/resize.
 * Implementations should return a Web Animations API `Animation` instance.
 *
 * - `enter` receives the element being inserted.
 * - `exit` receives the element being removed and its last-known rectangle
 *    relative to the measurement parent — useful for leaving the element in
 *    place while animating out.
 * - `move` receives the element that's moved and both current/previous rects
 *    to allow translation/scale-based transitions.
 * - `resize` receives the element and previous/new dimensions — note: the
 *    current component implementation doesn't automatically call `resize`,
 *    but implementations may document this hook for future use.
 */
export type TransitionPlugin = {
  /** Play when an element enters/was inserted into the container. */
  enter?(el: Element): Animation;
  /** Play when an element is removed; `rect` is the element's rect at removal time. */
  exit?(el: Element, rect: Rect): Animation;
  /** Play when an element moves within the container (position or size changes). */
  move?(el: Element, current: Rect, previous: Rect): Animation;
  /** Play when element is resized; not invoked by current implementation. */
  resize?(el: Element, current: Dimensions, previous: Dimensions): Animation;
};

/**
 * A higher-order component that wraps a component with `AutoTransition`.
 *
 * @template T - Element type of the component to wrap.
 * @param Component - The component to wrap.
 * @param options - Default props to pass to `AutoTransition`.
 * @returns A new component that automatically applies transitions.
 */
export function withAutoTransition<T extends ElementType, R extends ElementType>(
  Component: T,
  options?: Omit<AutoTransitionProps<R>, "children">,
): FC<ComponentProps<T>> {
  const WithAutoTransition = (props: ComponentProps<T>) => {
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AutoTransition {...(options as any)}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Component {...(props as any)} />
      </AutoTransition>
    );
  };
  const componentName =
    typeof Component === "string"
      ? Component
      : (Component as { displayName?: string; name?: string }).displayName ||
        (Component as { displayName?: string; name?: string }).name ||
        "Component";
  WithAutoTransition.displayName = `withAutoTransition(${componentName})`;
  return WithAutoTransition;
}
