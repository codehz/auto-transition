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
