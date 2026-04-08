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
import { planBatchAnimations, type BatchSnapshot, type PendingExitRecord } from "./batchPlan.ts";
import {
  buildEnterContext,
  buildExitContext,
  buildMoveContext,
  type ParentBounds,
  type Point,
  type Rect,
  type TransitionPlugin,
} from "./transitionTypes.ts";
import {
  defaultEnterTransition,
  defaultExitTransition,
  defaultMoveTransition,
  normalizeTransition,
} from "./transitionPresets.ts";
import { useForkRef } from "./useForkRef.ts";

export {
  buildEnterContext,
  buildExitContext,
  buildMoveContext,
  getMoveGeometry,
  getScaleFactor,
  type Dimensions,
  type CompiledTransitionPlugin,
  type EnterTransitionContext,
  type ExitTransitionContext,
  type MoveGeometry,
  type MoveTransitionContext,
  type ParentBounds,
  type Point,
  type Rect,
  type TransitionBaseContext,
  type TransitionKeyframes,
  type TransitionPhaseHandler,
  type TransitionPhaseLike,
  type TransitionPhaseRecipe,
  type TransitionPlugin,
  type TransitionTiming,
} from "./transitionTypes.ts";
export {
  defaultEnterTransition,
  defaultExitTransition,
  defaultMoveTransition,
  defineTransition,
  transitionPresets,
  type EnterFadeOptions,
  type EnterFadeScaleOptions,
  type EnterPopOptions,
  type EnterSlideFadeOptions,
  type ExitAbsoluteFadeOptions,
  type ExitAbsoluteFadeScaleOptions,
  type ExitAbsoluteShrinkOptions,
  type ExitAbsoluteSlideFadeOptions,
  type MoveFlipOptions,
  type MoveSmoothOptions,
  type MoveTranslateOptions,
} from "./transitionPresets.ts";

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

type SnapshotState = BatchSnapshot<Element>;

type LockedStyleState = {
  position: string;
  top: string;
  left: string;
  right: string;
  bottom: string;
  width: string;
  height: string;
  margin: string;
  pointerEvents: string;
};

type PendingExitState = PendingExitRecord<Element> & {
  lockedStyles: LockedStyleState;
};

type BatchState = {
  before: SnapshotState;
  pendingExits: Map<Element, PendingExitState>;
  pendingEnters: Set<Element>;
};

function lockNodeForExit(node: Element, rect: Rect): LockedStyleState {
  const style = (node as HTMLElement).style;
  const lockedStyles = {
    position: style.position,
    top: style.top,
    left: style.left,
    right: style.right,
    bottom: style.bottom,
    width: style.width,
    height: style.height,
    margin: style.margin,
    pointerEvents: style.pointerEvents,
  };
  style.position = "absolute";
  style.top = `${rect.y}px`;
  style.left = `${rect.x}px`;
  style.right = "auto";
  style.bottom = "auto";
  style.width = `${rect.width}px`;
  style.height = `${rect.height}px`;
  style.margin = "0";
  style.pointerEvents = "none";
  return lockedStyles;
}

function restoreLockedNode(node: Element, lockedStyles: LockedStyleState) {
  const style = (node as HTMLElement).style;
  style.position = lockedStyles.position;
  style.top = lockedStyles.top;
  style.left = lockedStyles.left;
  style.right = lockedStyles.right;
  style.bottom = lockedStyles.bottom;
  style.width = lockedStyles.width;
  style.height = lockedStyles.height;
  style.margin = lockedStyles.margin;
  style.pointerEvents = lockedStyles.pointerEvents;
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
 * The default enter/exit animations do not apply scale. If you want the
 * previous fade-scale behavior, use `transitionPresets.enter.fadeScale()`
 * and `transitionPresets.exit.absoluteFadeScale()`.
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
    const resolvedTransition = normalizeTransition(transition);
    const exiting = new Set<Element>();
    let batch: BatchState | null = null;
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

    function captureSnapshot(): SnapshotState {
      const parent = measureParentRect();
      const rects = new Map<Element, Rect>();
      for (const child of target.children) {
        if (!(child instanceof Element) || exiting.has(child)) continue;
        rects.set(child, getRelativePosition(child, parent));
      }
      return { parent, rects };
    }

    function ensureBatch(): BatchState {
      if (batch) {
        return batch;
      }

      const nextBatch: BatchState = {
        before: captureSnapshot(),
        pendingExits: new Map<Element, PendingExitState>(),
        pendingEnters: new Set<Element>(),
      };
      batch = nextBatch;

      queueMicrotask(() => {
        if (batch !== nextBatch) return;
        batch = null;
        flushBatch(nextBatch);
      });

      return nextBatch;
    }

    function flushBatch(activeBatch: BatchState) {
      const after = captureSnapshot();
      const finalNodes = Array.from(after.rects.keys());
      const plan = planBatchAnimations({
        before: activeBatch.before,
        after,
        finalNodes,
        pendingEnters: activeBatch.pendingEnters,
        pendingExits: activeBatch.pendingExits,
      });

      for (const move of plan.moves) {
        animateNodeMove(move.node, move.current, move.previous, after.parent, {
          anchorDelta: move.anchorDelta,
        });
      }

      for (const enter of plan.enters) {
        animateNodeEnter(enter.node, enter.rect, after.parent);
      }

      for (const exit of plan.exits) {
        animateNodeExit(exit.node, exit.rect, activeBatch.before.parent, {
          viewportRect: exit.viewportRect,
          anchorDelta: exit.anchorDelta,
        });
      }
    }

    target.removeChild = function removeChild<T extends Node>(node: T) {
      if (node instanceof Element) {
        if (exiting.has(node)) return node;

        const activeBatch = ensureBatch();
        if (activeBatch.pendingEnters.delete(node) && !activeBatch.before.rects.has(node)) {
          if (node.parentNode === target) {
            Element.prototype.removeChild.call(target, node);
          }
          return node;
        }

        const rect = activeBatch.before.rects.get(node) ?? getRelativePosition(node, activeBatch.before.parent);
        const viewportRect = getViewportRect(node.getBoundingClientRect());
        const lockedStyles = lockNodeForExit(node, rect);
        exiting.add(node);
        activeBatch.pendingExits.set(node, {
          node,
          rect,
          viewportRect,
          lockedStyles,
        });
        return node;
      }
      ensureBatch();
      return Element.prototype.removeChild.call(this, node) as T;
    };

    target.insertBefore = function insertBefore<T extends Node>(node: T, child: Node | null) {
      const activeBatch = ensureBatch();
      if (!(node instanceof Element)) {
        return Element.prototype.insertBefore.call(this, node, child) as T;
      }
      const inserted = Element.prototype.insertBefore.call(this, node, child) as T;
      const pendingExit = activeBatch.pendingExits.get(node);
      if (pendingExit) {
        activeBatch.pendingExits.delete(node);
        exiting.delete(node);
        restoreLockedNode(node, pendingExit.lockedStyles);
        return inserted;
      }
      if (!activeBatch.before.rects.has(node)) {
        activeBatch.pendingEnters.add(node);
      }
      return inserted;
    };

    target.appendChild = function appendChild<T extends Node>(node: T) {
      const activeBatch = ensureBatch();
      if (!(node instanceof Element)) {
        return Element.prototype.appendChild.call(this, node) as T;
      }
      const appended = Element.prototype.appendChild.call(this, node) as T;
      const pendingExit = activeBatch.pendingExits.get(node);
      if (pendingExit) {
        activeBatch.pendingExits.delete(node);
        exiting.delete(node);
        restoreLockedNode(node, pendingExit.lockedStyles);
        return appended;
      }
      if (!activeBatch.before.rects.has(node)) {
        activeBatch.pendingEnters.add(node);
      }
      return appended;
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
      const animation = resolvedTransition?.exit ? resolvedTransition.exit(context) : defaultExitTransition(context);
      const finalize = () => {
        exiting.delete(node);
        if (node.parentNode === target) {
          Element.prototype.removeChild.call(target, node);
        }
      };
      animation.finished.then(finalize).catch(finalize);
      return animation;
    }

    function animateNodeEnter(node: Element, rect?: Rect, parent?: MeasuredParentRect) {
      const currentParent = parent ?? measureParentRect();
      const currentRect = rect ?? getRelativePosition(node, currentParent);
      const context = buildEnterContext(node, currentRect, toParentBounds(currentParent));
      return resolvedTransition?.enter ? resolvedTransition.enter(context) : defaultEnterTransition(context);
    }

    function animateNodeMove(
      node: Element,
      rect: Rect,
      oldRect: Rect,
      parent: MeasuredParentRect,
      options?: {
        anchorDelta?: Point;
      },
    ) {
      const context = buildMoveContext(node, rect, oldRect, toParentBounds(parent), options);
      return resolvedTransition?.move ? resolvedTransition.move(context) : defaultMoveTransition(context);
    }

    function getRelativePosition(node: Element, parent = measureParentRect()): Rect {
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
