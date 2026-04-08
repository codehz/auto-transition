import type {
  CompiledTransitionPlugin,
  EnterTransitionContext,
  ExitTransitionContext,
  MoveGeometry,
  MoveTransitionContext,
  Point,
  TransitionBaseContext,
  TransitionPhaseLike,
  TransitionPhaseRecipe,
  TransitionPlugin,
  TransitionTiming,
} from "./transitionTypes.ts";

const DEFAULT_TRANSFORM_ORIGIN = "50% 50%";
const DEFAULT_MOVE_TRANSFORM_ORIGIN = "0 0";

type ScaleValue = number | MoveGeometry["scale"];
type Axis = "x" | "y";
type Direction = 1 | -1;

export type EnterFadeScaleOptions = {
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

export type EnterFadeOptions = Omit<EnterFadeScaleOptions, "fromScale" | "endScale">;

export type EnterSlideFadeOptions = Omit<
  EnterFadeScaleOptions,
  "fromTranslate" | "toTranslate" | "fromScale" | "endScale"
> & {
  axis?: Axis;
  direction?: Direction;
  distance?: number;
};

export type EnterPopOptions = Omit<EnterFadeScaleOptions, "endScale"> & {
  peakScale?: ScaleValue;
};

export type ExitAbsoluteFadeScaleOptions = {
  duration?: number;
  easing?: string;
  fromOpacity?: number;
  toOpacity?: number;
  fromScale?: ScaleValue;
  endScale?: ScaleValue;
  includeAnchorDelta?: boolean;
  transformOrigin?: string;
};

export type ExitAbsoluteFadeOptions = Omit<ExitAbsoluteFadeScaleOptions, "fromScale" | "endScale">;

export type ExitAbsoluteSlideFadeOptions = Omit<ExitAbsoluteFadeScaleOptions, "fromScale" | "endScale"> & {
  axis?: Axis;
  direction?: Direction;
  distance?: number;
};

export type ExitAbsoluteShrinkOptions = ExitAbsoluteFadeScaleOptions;

export type MoveFlipOptions = {
  duration?: number;
  easing?: string;
  includeAnchorDelta?: boolean;
  includeScale?: boolean;
  transformOrigin?: string;
};

export type MoveTranslateOptions = Omit<MoveFlipOptions, "includeScale">;

export type MoveSmoothOptions = MoveFlipOptions;

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

function addPoints(a: Point, b: Point): Point {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
  };
}

function directionalOffset(distance: number, axis: Axis, direction: Direction): Point {
  return axis === "x" ? { x: distance * direction, y: 0 } : { x: 0, y: distance * direction };
}

function resolveTransitionKeyframes<Ctx>(
  keyframes: TransitionPhaseRecipe<Ctx>["keyframes"],
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
  phase: TransitionPhaseLike<Ctx> | undefined,
): ((ctx: Ctx) => Animation) | undefined {
  if (!phase) {
    return undefined;
  }
  if (typeof phase === "function") {
    return phase;
  }
  return (ctx: Ctx) => createTransitionAnimation(ctx, phase);
}

function absoluteKeyframeBase(
  rect: ExitTransitionContext["rect"],
  opacity: number,
  transformOrigin: string,
  transform: string,
): Keyframe {
  return {
    position: "absolute",
    opacity,
    transformOrigin,
    transform,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    top: `${rect.y}px`,
    left: `${rect.x}px`,
  };
}

function createEnterFadeScale({
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
}

function createExitAbsoluteFadeScale({
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
      const translate = includeAnchorDelta ? anchorDelta : undefined;
      const startKeyframe = absoluteKeyframeBase(
        rect,
        fromOpacity,
        transformOrigin,
        buildTransform({
          translate,
          scale: toScale(fromScale, 1),
        }),
      );

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
}

function createMoveFlip({
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
}

export function defineTransition(transition: TransitionPlugin): CompiledTransitionPlugin {
  return {
    enter: compileTransitionPhase(transition.enter),
    exit: compileTransitionPhase(transition.exit),
    move: compileTransitionPhase(transition.move),
  };
}

export function normalizeTransition(transition: TransitionPlugin | undefined): CompiledTransitionPlugin | undefined {
  if (!transition) {
    return undefined;
  }
  return defineTransition(transition);
}

export const transitionPresets = {
  enter: {
    fadeScale(options: EnterFadeScaleOptions = {}): TransitionPhaseRecipe<EnterTransitionContext> {
      return createEnterFadeScale(options);
    },
    fade(options: EnterFadeOptions = {}): TransitionPhaseRecipe<EnterTransitionContext> {
      return createEnterFadeScale({
        ...options,
        fromScale: 1,
        endScale: 1,
      });
    },
    slideFade({
      axis = "y",
      direction = 1,
      distance = 16,
      ...options
    }: EnterSlideFadeOptions = {}): TransitionPhaseRecipe<EnterTransitionContext> {
      return createEnterFadeScale({
        ...options,
        fromScale: 1,
        endScale: 1,
        fromTranslate: directionalOffset(distance, axis, direction),
        toTranslate: { x: 0, y: 0 },
      });
    },
    pop({
      duration = 280,
      easing = "cubic-bezier(0.16, 1, 0.3, 1)",
      fromOpacity = 0,
      toOpacity = 1,
      fromScale = 0.9,
      peakScale = 1.03,
      fromTranslate,
      toTranslate,
      transformOrigin = DEFAULT_TRANSFORM_ORIGIN,
    }: EnterPopOptions = {}): TransitionPhaseRecipe<EnterTransitionContext> {
      return {
        keyframes: {
          opacity: [fromOpacity, toOpacity, toOpacity],
          transformOrigin: [transformOrigin, transformOrigin, transformOrigin],
          transform: [
            buildTransform({
              translate: fromTranslate,
              scale: toScale(fromScale, 1),
            }),
            buildTransform({
              translate: toTranslate,
              scale: toScale(peakScale, 1),
            }),
            buildTransform({
              translate: toTranslate,
              scale: { x: 1, y: 1 },
            }),
          ],
        },
        options: { duration, easing },
      };
    },
  },
  exit: {
    absoluteFadeScale(options: ExitAbsoluteFadeScaleOptions = {}): TransitionPhaseRecipe<ExitTransitionContext> {
      return createExitAbsoluteFadeScale(options);
    },
    absoluteFade(options: ExitAbsoluteFadeOptions = {}): TransitionPhaseRecipe<ExitTransitionContext> {
      return createExitAbsoluteFadeScale({
        ...options,
        fromScale: 1,
        endScale: 1,
      });
    },
    absoluteSlideFade({
      axis = "y",
      direction = -1,
      distance = 16,
      duration = 220,
      easing = "ease-in",
      fromOpacity = 1,
      toOpacity = 0,
      includeAnchorDelta = true,
      transformOrigin = DEFAULT_TRANSFORM_ORIGIN,
    }: ExitAbsoluteSlideFadeOptions = {}): TransitionPhaseRecipe<ExitTransitionContext> {
      return {
        keyframes: ({ rect, anchorDelta }) => {
          const baseTranslate = includeAnchorDelta ? anchorDelta : { x: 0, y: 0 };
          const endTranslate = addPoints(baseTranslate, directionalOffset(distance, axis, direction));
          const startKeyframe = absoluteKeyframeBase(
            rect,
            fromOpacity,
            transformOrigin,
            buildTransform({
              translate: baseTranslate,
              scale: { x: 1, y: 1 },
            }),
          );

          return [
            startKeyframe,
            {
              ...startKeyframe,
              opacity: toOpacity,
              transform: buildTransform({
                translate: endTranslate,
                scale: { x: 1, y: 1 },
              }),
            },
          ];
        },
        options: { duration, easing },
      };
    },
    absoluteShrink(options: ExitAbsoluteShrinkOptions = {}): TransitionPhaseRecipe<ExitTransitionContext> {
      return createExitAbsoluteFadeScale({
        duration: 220,
        easing: "ease-in",
        endScale: 0.9,
        ...options,
      });
    },
  },
  move: {
    flip(options: MoveFlipOptions = {}): TransitionPhaseRecipe<MoveTransitionContext> {
      return createMoveFlip(options);
    },
    translate(options: MoveTranslateOptions = {}): TransitionPhaseRecipe<MoveTransitionContext> {
      return createMoveFlip({
        duration: 220,
        easing: "ease-out",
        ...options,
        includeScale: false,
      });
    },
    smooth(options: MoveSmoothOptions = {}): TransitionPhaseRecipe<MoveTransitionContext> {
      return createMoveFlip({
        duration: 320,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        ...options,
      });
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
