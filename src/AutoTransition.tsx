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
import {
  getExitInsets,
  getMoveGeometry,
  measureBox,
  rectFromBox,
  type Anchor,
  type AnchorPoint,
  type ExitInsets,
  type MoveGeometry,
  type ParentBounds,
} from "./anchor.ts";
import { patchActivity } from "./ActivityPatch.tsx";
import { useForkRef } from "./useForkRef.ts";

export type { Anchor, AnchorPoint, ExitInsets, MoveGeometry, ParentBounds } from "./anchor.ts";

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
 * Complete element box measured against the active measurement parent.
 *
 * - `top`/`left`/`right`/`bottom` are offsets to each content-box edge.
 * - `width`/`height` are the element's layout size in pixels.
 */
export type MeasuredBox = {
  top: number;
  right: number;
  bottom: number;
  left: number;
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

export type TransitionBaseContext = {
  element: Element;
  anchor: Anchor;
  parent: ParentBounds;
};

export type EnterTransitionContext = TransitionBaseContext & {
  rect: Rect;
  box: MeasuredBox;
};

export type ExitTransitionContext = TransitionBaseContext & {
  rect: Rect;
  box: MeasuredBox;
  beforeBox: MeasuredBox;
  beforeParent: ParentBounds;
  insets: ExitInsets;
};

export type MoveTransitionContext = TransitionBaseContext & {
  current: Rect;
  previous: Rect;
  currentBox: MeasuredBox;
  previousBox: MeasuredBox;
  currentParent: ParentBounds;
  previousParent: ParentBounds;
  delta: AnchorPoint;
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

type ViewportRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type NodeMeasurement = {
  rect: Rect;
  box: MeasuredBox;
  viewport: ViewportRect;
};

type LayoutSnapshot = {
  parent: MeasuredParentRect;
  nodes: Map<Element, NodeMeasurement>;
};

/**
 * Common props for `AutoTransition`.
 *
 * @template T - Element type to render as (e.g., "div", "ul").
 */
type AutoTransitionBaseProps<T extends ElementType | undefined> = {
  as?: T;
  anchor?: Anchor;
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

export function buildEnterContext(
  element: Element,
  rect: Rect,
  anchor: Anchor,
  parent: ParentBounds,
  box = measureBox(rect, parent),
): EnterTransitionContext {
  return { element, rect, box, anchor, parent };
}

export function buildExitContext(
  element: Element,
  rect: Rect,
  anchor: Anchor,
  parent: ParentBounds,
  options?: {
    box?: MeasuredBox;
    beforeBox?: MeasuredBox;
    beforeParent?: ParentBounds;
  },
): ExitTransitionContext {
  const box = options?.box ?? measureBox(rect, parent);
  const beforeBox = options?.beforeBox ?? box;
  const beforeParent = options?.beforeParent ?? parent;
  return {
    element,
    rect,
    box,
    beforeBox,
    beforeParent,
    anchor,
    parent,
    insets: getExitInsets(box, anchor),
  };
}

export function buildMoveContext(
  element: Element,
  current: Rect,
  previous: Rect,
  anchor: Anchor,
  parent: ParentBounds,
  options?: {
    currentBox?: MeasuredBox;
    previousBox?: MeasuredBox;
    currentParent?: ParentBounds;
    previousParent?: ParentBounds;
  },
): MoveTransitionContext {
  const currentBox = options?.currentBox ?? measureBox(current, options?.currentParent ?? parent);
  const previousBox = options?.previousBox ?? measureBox(previous, options?.previousParent ?? parent);
  const currentParent = options?.currentParent ?? parent;
  const previousParent = options?.previousParent ?? parent;
  const geometry = getMoveGeometry(currentBox, previousBox, anchor);
  return {
    element,
    anchor,
    parent,
    current,
    previous,
    currentBox,
    previousBox,
    currentParent,
    previousParent,
    delta: geometry.delta,
    scale: geometry.scale,
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

export function defaultExitTransition({ element, box, insets }: ExitTransitionContext): Animation {
  const width = `${box.width}px`;
  const height = `${box.height}px`;
  const startKeyframe: Keyframe = {
    position: "absolute",
    opacity: 1,
    transformOrigin: DEFAULT_TRANSFORM_ORIGIN,
    transform: "scale(1, 1)",
    width,
    height,
    margin: "0",
  };
  if (insets.top !== undefined) {
    startKeyframe.top = `${insets.top}px`;
  }
  if (insets.right !== undefined) {
    startKeyframe.right = `${insets.right}px`;
  }
  if (insets.bottom !== undefined) {
    startKeyframe.bottom = `${insets.bottom}px`;
  }
  if (insets.left !== undefined) {
    startKeyframe.left = `${insets.left}px`;
  }
  const endKeyframe: Keyframe = {
    ...startKeyframe,
    opacity: 0,
    transform: "scale(0.96, 0.96)",
  };
  return element.animate([startKeyframe, endKeyframe], { duration: 250, easing: "ease-in" });
}

export function defaultMoveTransition({ element, delta, scale }: MoveTransitionContext): Animation {
  return element.animate(
    {
      transformOrigin: [DEFAULT_TRANSFORM_ORIGIN, DEFAULT_TRANSFORM_ORIGIN],
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

function toViewportRect(rect: DOMRect): ViewportRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function projectViewportRectToBox(viewport: ViewportRect, parent: MeasuredParentRect): MeasuredBox {
  const rect: Rect = {
    x: viewport.left - parent.left,
    y: viewport.top - parent.top,
    width: viewport.width,
    height: viewport.height,
  };
  return measureBox(rect, toParentBounds(parent));
}

function hasMeaningfulMove(current: MeasuredBox, previous: MeasuredBox, anchor: Anchor): boolean {
  const geometry = getMoveGeometry(current, previous, anchor);
  return geometry.delta.x !== 0 || geometry.delta.y !== 0 || geometry.scale.x !== 1 || geometry.scale.y !== 1;
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
  anchor = "top-left",
  children,
  transition,
  ref: externalRef,
  patch,
  ...rest
}: AutoTransitionProps<T>) {
  const Component = as ?? Slot;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const exiting = new Set<Element>();
    const pendingExit = new Map<
      Element,
      {
        before: NodeMeasurement;
        beforeParent: MeasuredParentRect;
      }
    >();
    const pendingEnter = new Set<Element>();
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

    let beforeSnapshot: LayoutSnapshot | null = null;
    let flushScheduled = false;

    function parentRect(): MeasuredParentRect {
      const measurementStyles = getComputedStyle(measureTarget);
      const borderBox = measureTarget.getBoundingClientRect();
      const borderLeft = parseFloat(measurementStyles.borderLeftWidth || "0");
      const borderRight = parseFloat(measurementStyles.borderRightWidth || "0");
      const borderTop = parseFloat(measurementStyles.borderTopWidth || "0");
      const borderBottom = parseFloat(measurementStyles.borderBottomWidth || "0");
      return {
        left: borderBox.left + borderLeft,
        top: borderBox.top + borderTop,
        width: borderBox.width - borderLeft - borderRight,
        height: borderBox.height - borderTop - borderBottom,
      };
    }

    function captureNode(node: Element, parent = parentRect()): NodeMeasurement {
      const viewport = toViewportRect(node.getBoundingClientRect());
      const rect: Rect = {
        x: viewport.left - parent.left,
        y: viewport.top - parent.top,
        width: viewport.width,
        height: viewport.height,
      };
      return {
        rect,
        box: measureBox(rect, toParentBounds(parent)),
        viewport,
      };
    }

    function captureSnapshot(): LayoutSnapshot {
      const parent = parentRect();
      const nodes = new Map<Element, NodeMeasurement>();
      for (const child of target.children) {
        if (!(child instanceof Element) || exiting.has(child)) continue;
        nodes.set(child, captureNode(child, parent));
      }
      return { parent, nodes };
    }

    function ensureBeforeSnapshot() {
      if (!beforeSnapshot) {
        beforeSnapshot = captureSnapshot();
      }
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flushMutations);
      }
    }

    target.removeChild = function removeChild<T extends Node>(node: T) {
      ensureBeforeSnapshot();
      if (node instanceof Element) {
        if (exiting.has(node)) return node;
        const measurement = beforeSnapshot?.nodes.get(node) ?? captureNode(node);
        const snapshotParent = beforeSnapshot?.parent ?? parentRect();
        pendingEnter.delete(node);
        prepareNodeForExit(node, measurement.box);
        exiting.add(node);
        pendingExit.set(node, {
          before: measurement,
          beforeParent: snapshotParent,
        });
        return node;
      }
      return Element.prototype.removeChild.call(this, node) as T;
    };

    target.insertBefore = function insertBefore<T extends Node>(node: T, child: Node | null) {
      ensureBeforeSnapshot();
      if (!(node instanceof Element)) {
        return Element.prototype.insertBefore.call(this, node, child) as T;
      }
      Element.prototype.insertBefore.call(this, node, child);
      pendingEnter.add(node);
      return node;
    };

    target.appendChild = function appendChild<T extends Node>(node: T) {
      ensureBeforeSnapshot();
      if (!(node instanceof Element)) {
        return Element.prototype.appendChild.call(this, node) as T;
      }
      Element.prototype.appendChild.call(this, node);
      pendingEnter.add(node);
      return node;
    };

    return () => {
      target.removeChild = Element.prototype.removeChild;
      target.insertBefore = Element.prototype.insertBefore;
      target.appendChild = Element.prototype.appendChild;
    };

    function flushMutations() {
      flushScheduled = false;
      const previous = beforeSnapshot;
      beforeSnapshot = null;
      if (!previous) return;

      const current = captureSnapshot();

      for (const child of target.children) {
        if (!(child instanceof Element) || exiting.has(child)) continue;
        const currentMeasurement = current.nodes.get(child);
        if (!currentMeasurement) continue;
        const previousMeasurement = previous.nodes.get(child);
        if (previousMeasurement && hasMeaningfulMove(currentMeasurement.box, previousMeasurement.box, anchor)) {
          animateNodeMove(child, currentMeasurement, previousMeasurement, current.parent, previous.parent);
          continue;
        }
        if (pendingEnter.has(child)) {
          animateNodeEnter(child, currentMeasurement, current.parent);
        }
      }

      for (const [node, exitState] of pendingExit) {
        animateNodeExit(node, exitState.before, exitState.beforeParent, current.parent);
      }

      pendingEnter.clear();
      pendingExit.clear();
    }

    function prepareNodeForExit(node: Element, box: MeasuredBox) {
      const element = node as HTMLElement | SVGElement;
      element.style.position = "absolute";
      element.style.top = `${box.top}px`;
      element.style.left = `${box.left}px`;
      element.style.right = "auto";
      element.style.bottom = "auto";
      element.style.width = `${box.width}px`;
      element.style.height = `${box.height}px`;
      element.style.margin = "0";
    }

    function animateNodeExit(
      node: Element,
      before: NodeMeasurement,
      beforeParent: MeasuredParentRect,
      parent: MeasuredParentRect,
    ) {
      const box = projectViewportRectToBox(before.viewport, parent);
      const rect = rectFromBox(box);
      const context = buildExitContext(node, rect, anchor, toParentBounds(parent), {
        box,
        beforeBox: before.box,
        beforeParent: toParentBounds(beforeParent),
      });
      const animation = transition?.exit ? transition.exit(context) : defaultExitTransition(context);
      animation.finished.finally(() => {
        exiting.delete(node);
        node.remove();
      });
      return animation;
    }

    function animateNodeEnter(node: Element, measurement: NodeMeasurement, parent: MeasuredParentRect) {
      const context = buildEnterContext(node, measurement.rect, anchor, toParentBounds(parent), measurement.box);
      return transition?.enter ? transition.enter(context) : defaultEnterTransition(context);
    }

    function animateNodeMove(
      node: Element,
      measurement: NodeMeasurement,
      previousMeasurement: NodeMeasurement,
      parent: MeasuredParentRect,
      previousParent: MeasuredParentRect,
    ) {
      const context = buildMoveContext(
        node,
        measurement.rect,
        previousMeasurement.rect,
        anchor,
        toParentBounds(parent),
        {
          currentBox: measurement.box,
          previousBox: previousMeasurement.box,
          currentParent: toParentBounds(parent),
          previousParent: toParentBounds(previousParent),
        },
      );
      return transition?.move ? transition.move(context) : defaultMoveTransition(context);
    }
  }, [anchor, patch, transition]);

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
