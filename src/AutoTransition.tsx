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
import { patchActivity } from "./ActivityPatch.tsx";
import { microcache } from "./microcache.ts";
import { useForkRef } from "./useForkRef.ts";

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

export type Point = {
  x: number;
  y: number;
};

export type ParentBounds = {
  width: number;
  height: number;
};

export type MoveGeometry = {
  delta: Point;
  scale: {
    x: number;
    y: number;
  };
};

export type TransitionBaseContext = {
  element: Element;
  parent: ParentBounds;
};

export type EnterTransitionContext = TransitionBaseContext & {
  rect: Rect;
};

export type ExitTransitionContext = TransitionBaseContext & {
  rect: Rect;
  viewportRect: Rect;
  anchorDelta: Point;
};

export type MoveTransitionContext = TransitionBaseContext & {
  current: Rect;
  previous: Rect;
  delta: Point;
  scale: MoveGeometry["scale"];
};

export type TransitionPlugin = {
  enter?(ctx: EnterTransitionContext): Animation;
  exit?(ctx: ExitTransitionContext): Animation;
  move?(ctx: MoveTransitionContext): Animation;
};

const DEFAULT_TRANSFORM_ORIGIN = "50% 50%";

type MeasuredParentRect = ParentBounds & {
  left: number;
  top: number;
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

export function buildEnterContext(element: Element, rect: Rect, parent: ParentBounds): EnterTransitionContext {
  return { element, rect, parent };
}

export function buildExitContext(
  element: Element,
  rect: Rect,
  parent: ParentBounds,
  options: {
    viewportRect?: Rect;
    anchorDelta?: Point;
  } = {},
): ExitTransitionContext {
  return {
    element,
    rect,
    parent,
    viewportRect: options.viewportRect ?? rect,
    anchorDelta: options.anchorDelta ?? { x: 0, y: 0 },
  };
}

export function buildMoveContext(
  element: Element,
  current: Rect,
  previous: Rect,
  parent: ParentBounds,
): MoveTransitionContext {
  const geometry = getMoveGeometry(current, previous);
  return {
    element,
    parent,
    current,
    previous,
    delta: geometry.delta,
    scale: geometry.scale,
  };
}

export function getScaleFactor(previous: number, current: number): number {
  return current === 0 ? 1 : previous / current;
}

export function getMoveGeometry(current: Rect, previous: Rect): MoveGeometry {
  return {
    delta: {
      x: previous.x - current.x,
      y: previous.y - current.y,
    },
    scale: {
      x: getScaleFactor(previous.width, current.width),
      y: getScaleFactor(previous.height, current.height),
    },
  };
}

export function defaultEnterTransition({ element }: EnterTransitionContext): Animation {
  return element.animate(
    {
      opacity: [0, 1],
      transformOrigin: [DEFAULT_TRANSFORM_ORIGIN, DEFAULT_TRANSFORM_ORIGIN],
      transform: ["scale(0.96, 0.96)", "scale(1, 1)"],
    },
    { duration: 250, easing: "ease-out" },
  );
}

export function defaultExitTransition({ element, rect, anchorDelta }: ExitTransitionContext): Animation {
  const width = `${rect.width}px`;
  const height = `${rect.height}px`;
  const startTransform = getExitTransform(anchorDelta, 1);
  const endTransform = getExitTransform(anchorDelta, 0.96);
  const startKeyframe: Keyframe = {
    position: "absolute",
    opacity: 1,
    transformOrigin: DEFAULT_TRANSFORM_ORIGIN,
    transform: startTransform,
    width,
    height,
    margin: "0",
    top: `${rect.y}px`,
    left: `${rect.x}px`,
  };
  const endKeyframe: Keyframe = {
    ...startKeyframe,
    opacity: 0,
    transform: endTransform,
  };
  return element.animate([startKeyframe, endKeyframe], { duration: 250, easing: "ease-in" });
}

export function defaultMoveTransition({ element, delta, scale }: MoveTransitionContext): Animation {
  return element.animate(
    {
      transformOrigin: ["0 0", "0 0"],
      transform: [`translate(${delta.x}px, ${delta.y}px) scale(${scale.x}, ${scale.y})`, "translate(0, 0) scale(1, 1)"],
    },
    { duration: 250, easing: "ease-in" },
  );
}

function toParentBounds(parent: MeasuredParentRect): ParentBounds {
  return {
    width: parent.width,
    height: parent.height,
  };
}

function getViewportRect(rect: DOMRectReadOnly): Rect {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function getExitAnchorDelta(
  previousParent: Pick<MeasuredParentRect, "left" | "top">,
  nextParent: Pick<MeasuredParentRect, "left" | "top">,
): Point {
  return {
    x: previousParent.left - nextParent.left,
    y: previousParent.top - nextParent.top,
  };
}

function getExitTransform(anchorDelta: Point, scale: number): string {
  const scaleTransform = `scale(${scale}, ${scale})`;
  if (anchorDelta.x === 0 && anchorDelta.y === 0) {
    return scaleTransform;
  }
  return `translate(${anchorDelta.x}px, ${anchorDelta.y}px) ${scaleTransform}`;
}

function lockNodeForExit(node: Element, rect: Rect) {
  const style = (node as HTMLElement).style;
  style.position = "absolute";
  style.top = `${rect.y}px`;
  style.left = `${rect.x}px`;
  style.right = "auto";
  style.bottom = "auto";
  style.width = `${rect.width}px`;
  style.height = `${rect.height}px`;
  style.margin = "0";
  style.pointerEvents = "none";
}

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
 *   {isOpen && <PanelContent />}
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

    function measureParentRect(): MeasuredParentRect {
      const borderBox = measureTarget.getBoundingClientRect();
      const currentStyles = getComputedStyle(measureTarget);
      const borderLeft = parseFloat(currentStyles.borderLeftWidth || "0");
      const borderRight = parseFloat(currentStyles.borderRightWidth || "0");
      const borderTop = parseFloat(currentStyles.borderTopWidth || "0");
      const borderBottom = parseFloat(currentStyles.borderBottomWidth || "0");
      return {
        left: borderBox.left + borderLeft,
        top: borderBox.top + borderTop,
        width: borderBox.width - borderLeft - borderRight,
        height: borderBox.height - borderTop - borderBottom,
      };
    }

    const parentRect = microcache((): MeasuredParentRect => measureParentRect());

    const snapshot = microcache(
      () => {
        const parent = parentRect();
        const result = new Map<Element, Rect>();
        for (const child of target.children) {
          if (child instanceof Element) {
            result.set(child, getRelativePosition(child, parent));
          }
        }
        return result;
      },
      (old) => {
        const parent = parentRect();
        for (const child of target.children) {
          if (child instanceof Element) {
            if (removed.has(child)) continue;
            const rect = getRelativePosition(child, parent);
            const oldRect = old.get(child);
            if (!oldRect) continue;
            if (
              rect.x !== oldRect.x ||
              rect.y !== oldRect.y ||
              rect.width !== oldRect.width ||
              rect.height !== oldRect.height
            ) {
              animateNodeMove(child, rect, oldRect, parent);
            }
          }
        }
      },
    );

    target.removeChild = function removeChild<T extends Node>(node: T) {
      if (node instanceof Element) {
        if (removed.has(node)) return node;
        removed.add(node);
        const previousParent = measureParentRect();
        const rect = snapshot().get(node) ?? getRelativePosition(node, previousParent);
        const viewportRect = getViewportRect(node.getBoundingClientRect());
        lockNodeForExit(node, rect);
        const nextParent = measureParentRect();
        const anchorDelta = getExitAnchorDelta(previousParent, nextParent);
        animateNodeExit(node, rect, previousParent, { viewportRect, anchorDelta });
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

    function animateNodeExit(
      node: Element,
      rect: Rect,
      parent: MeasuredParentRect,
      options?: {
        viewportRect?: Rect;
        anchorDelta?: Point;
      },
    ) {
      const context = buildExitContext(node, rect, toParentBounds(parent), options);
      const animation = transition?.exit ? transition.exit(context) : defaultExitTransition(context);
      const finalize = () => {
        removed.delete(node);
        if (node.parentNode === target) {
          Element.prototype.removeChild.call(target, node);
        }
      };
      animation.finished.then(finalize).catch(finalize);
      return animation;
    }

    function animateNodeEnter(node: Element) {
      const parent = parentRect();
      const rect = getRelativePosition(node, parent);
      const context = buildEnterContext(node, rect, toParentBounds(parent));
      return transition?.enter ? transition.enter(context) : defaultEnterTransition(context);
    }

    function animateNodeMove(node: Element, rect: Rect, oldRect: Rect, parent: MeasuredParentRect) {
      const context = buildMoveContext(node, rect, oldRect, toParentBounds(parent));
      return transition?.move ? transition.move(context) : defaultMoveTransition(context);
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
