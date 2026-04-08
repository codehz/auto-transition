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
  anchorDelta: Point;
  scale: MoveGeometry["scale"];
};

export type TransitionPlugin = {
  enter?(ctx: EnterTransitionContext): Animation;
  exit?(ctx: ExitTransitionContext): Animation;
  move?(ctx: MoveTransitionContext): Animation;
};

export type TransitionKeyframes<Ctx> =
  | Keyframe[]
  | PropertyIndexedKeyframes
  | ((ctx: Ctx) => Keyframe[] | PropertyIndexedKeyframes);

export type TransitionTiming<Ctx> = KeyframeAnimationOptions | ((ctx: Ctx) => KeyframeAnimationOptions);

export type TransitionPhaseRecipe<Ctx> = {
  keyframes: TransitionKeyframes<Ctx>;
  options?: TransitionTiming<Ctx>;
};

export type TransitionRecipe = {
  enter?: TransitionPhaseRecipe<EnterTransitionContext>;
  exit?: TransitionPhaseRecipe<ExitTransitionContext>;
  move?: TransitionPhaseRecipe<MoveTransitionContext>;
};

export type TransitionLike = TransitionPlugin | TransitionRecipe;

const DEFAULT_TRANSFORM_ORIGIN = "50% 50%";
const DEFAULT_MOVE_TRANSFORM_ORIGIN = "0 0";

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
  transition?: TransitionLike;
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
  options: {
    anchorDelta?: Point;
  } = {},
): MoveTransitionContext {
  const geometry = getMoveGeometry(current, previous);
  return {
    element,
    parent,
    current,
    previous,
    delta: geometry.delta,
    anchorDelta: options.anchorDelta ?? { x: 0, y: 0 },
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

type ScaleValue = number | MoveGeometry["scale"];

type EnterFadeScaleOptions = {
  duration?: number;
  easing?: string;
  fromOpacity?: number;
  toOpacity?: number;
  fromScale?: ScaleValue;
  endScale?: ScaleValue;
  fromTranslate?: Point;
  toTranslate?: Point;
  transformOrigin?: string;
};

type ExitAbsoluteFadeScaleOptions = {
  duration?: number;
  easing?: string;
  fromOpacity?: number;
  toOpacity?: number;
  fromScale?: ScaleValue;
  endScale?: ScaleValue;
  includeAnchorDelta?: boolean;
  transformOrigin?: string;
};

type MoveFlipOptions = {
  duration?: number;
  easing?: string;
  includeAnchorDelta?: boolean;
  includeScale?: boolean;
  transformOrigin?: string;
};

function toScale(value: ScaleValue | undefined, fallback: number): MoveGeometry["scale"] {
  if (typeof value === "number") {
    return { x: value, y: value };
  }
  if (value) {
    return value;
  }
  return { x: fallback, y: fallback };
}

function isZeroPoint(point: Point | undefined): boolean {
  return !point || (point.x === 0 && point.y === 0);
}

function formatTranslate(point: Point): string {
  if (point.x === 0 && point.y === 0) {
    return "translate(0, 0)";
  }
  return `translate(${point.x}px, ${point.y}px)`;
}

function formatScale(scale: MoveGeometry["scale"]): string {
  return `scale(${scale.x}, ${scale.y})`;
}

function buildTransform({
  translate,
  scale,
  includeTranslateWhenZero = false,
  includeScaleWhenIdentity = true,
}: {
  translate?: Point;
  scale?: MoveGeometry["scale"];
  includeTranslateWhenZero?: boolean;
  includeScaleWhenIdentity?: boolean;
}): string {
  const parts: string[] = [];

  if (translate && (includeTranslateWhenZero || !isZeroPoint(translate))) {
    parts.push(formatTranslate(translate));
  }

  if (scale && (includeScaleWhenIdentity || scale.x !== 1 || scale.y !== 1)) {
    parts.push(formatScale(scale));
  }

  return parts.join(" ");
}

function resolveTransitionKeyframes<Ctx>(
  keyframes: TransitionKeyframes<Ctx>,
  ctx: Ctx,
): Keyframe[] | PropertyIndexedKeyframes {
  return typeof keyframes === "function" ? keyframes(ctx) : keyframes;
}

function resolveTransitionOptions<Ctx>(
  options: TransitionTiming<Ctx> | undefined,
  ctx: Ctx,
): KeyframeAnimationOptions | undefined {
  return typeof options === "function" ? options(ctx) : options;
}

function createTransitionAnimation<Ctx extends TransitionBaseContext>(
  ctx: Ctx,
  recipe: TransitionPhaseRecipe<Ctx>,
): Animation {
  return ctx.element.animate(
    resolveTransitionKeyframes(recipe.keyframes, ctx),
    resolveTransitionOptions(recipe.options, ctx),
  );
}

function compileTransitionPhase<Ctx extends TransitionBaseContext>(
  recipe: TransitionPhaseRecipe<Ctx> | undefined,
): ((ctx: Ctx) => Animation) | undefined {
  if (!recipe) {
    return undefined;
  }
  return (ctx: Ctx) => createTransitionAnimation(ctx, recipe);
}

export function defineTransition(recipe: TransitionRecipe): TransitionPlugin {
  return {
    enter: compileTransitionPhase(recipe.enter),
    exit: compileTransitionPhase(recipe.exit),
    move: compileTransitionPhase(recipe.move),
  };
}

function isTransitionRecipe(transition: TransitionLike): transition is TransitionRecipe {
  for (const phase of [transition.enter, transition.exit, transition.move]) {
    if (phase == null) continue;
    return typeof phase !== "function";
  }
  return true;
}

function normalizeTransition(transition: TransitionLike | undefined): TransitionPlugin | undefined {
  if (!transition) {
    return undefined;
  }
  return isTransitionRecipe(transition) ? defineTransition(transition) : transition;
}

export const transitionPresets = {
  enter: {
    fadeScale({
      duration = 250,
      easing = "ease-out",
      fromOpacity = 0,
      toOpacity = 1,
      fromScale = 0.96,
      endScale = 1,
      fromTranslate,
      toTranslate,
      transformOrigin = DEFAULT_TRANSFORM_ORIGIN,
    }: EnterFadeScaleOptions = {}): TransitionPhaseRecipe<EnterTransitionContext> {
      return {
        keyframes: {
          opacity: [fromOpacity, toOpacity],
          transformOrigin: [transformOrigin, transformOrigin],
          transform: [
            buildTransform({
              translate: fromTranslate,
              scale: toScale(fromScale, 1),
            }),
            buildTransform({
              translate: toTranslate,
              scale: toScale(endScale, 1),
            }),
          ],
        },
        options: { duration, easing },
      };
    },
  },
  exit: {
    absoluteFadeScale({
      duration = 250,
      easing = "ease-in",
      fromOpacity = 1,
      toOpacity = 0,
      fromScale = 1,
      endScale = 0.96,
      includeAnchorDelta = true,
      transformOrigin = DEFAULT_TRANSFORM_ORIGIN,
    }: ExitAbsoluteFadeScaleOptions = {}): TransitionPhaseRecipe<ExitTransitionContext> {
      return {
        keyframes: ({ rect, anchorDelta }) => {
          const width = `${rect.width}px`;
          const height = `${rect.height}px`;
          const translate = includeAnchorDelta ? anchorDelta : undefined;
          const startKeyframe: Keyframe = {
            position: "absolute",
            opacity: fromOpacity,
            transformOrigin,
            transform: buildTransform({
              translate,
              scale: toScale(fromScale, 1),
            }),
            width,
            height,
            margin: "0",
            top: `${rect.y}px`,
            left: `${rect.x}px`,
          };

          return [
            startKeyframe,
            {
              ...startKeyframe,
              opacity: toOpacity,
              transform: buildTransform({
                translate,
                scale: toScale(endScale, 1),
              }),
            },
          ];
        },
        options: { duration, easing },
      };
    },
  },
  move: {
    flip({
      duration = 250,
      easing = "ease-in",
      includeAnchorDelta = true,
      includeScale = true,
      transformOrigin = DEFAULT_MOVE_TRANSFORM_ORIGIN,
    }: MoveFlipOptions = {}): TransitionPhaseRecipe<MoveTransitionContext> {
      return {
        keyframes: ({ delta, anchorDelta, scale }) => {
          const compensatedDelta = {
            x: delta.x + (includeAnchorDelta ? anchorDelta.x : 0),
            y: delta.y + (includeAnchorDelta ? anchorDelta.y : 0),
          };

          return {
            transformOrigin: [transformOrigin, transformOrigin],
            transform: [
              buildTransform({
                translate: compensatedDelta,
                scale: includeScale ? scale : undefined,
                includeTranslateWhenZero: true,
                includeScaleWhenIdentity: includeScale,
              }),
              buildTransform({
                translate: { x: 0, y: 0 },
                scale: includeScale ? { x: 1, y: 1 } : undefined,
                includeTranslateWhenZero: true,
                includeScaleWhenIdentity: includeScale,
              }),
            ],
          };
        },
        options: { duration, easing },
      };
    },
  },
} as const;

const defaultTransition = defineTransition({
  enter: transitionPresets.enter.fadeScale(),
  exit: transitionPresets.exit.absoluteFadeScale(),
  move: transitionPresets.move.flip(),
});

export function defaultEnterTransition(ctx: EnterTransitionContext): Animation {
  return defaultTransition.enter!(ctx);
}

export function defaultExitTransition(ctx: ExitTransitionContext): Animation {
  return defaultTransition.exit!(ctx);
}

export function defaultMoveTransition(ctx: MoveTransitionContext): Animation {
  return defaultTransition.move!(ctx);
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
