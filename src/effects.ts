import type {
  EnterTransitionContext,
  ExitTransitionContext,
  MoveGeometry,
  MoveTransitionContext,
  Point,
  RelativePoint,
  TransitionEffect,
} from "./transitionTypes.ts";
import {
  addPoints,
  createTransitionEffect,
  DEFAULT_MOVE_TRANSFORM_ORIGIN,
  DEFAULT_TRANSFORM_ORIGIN,
  getElementOpacity,
  toScale,
} from "./transitionPresets.ts";

type ValueKeyframe<T> = {
  offset: number;
  value: T;
};

type ScaleValue = number | MoveGeometry["scale"];
type BlurValue = number | string;
type EnterOrExitContext = EnterTransitionContext | ExitTransitionContext;

type PhaseName = "enter" | "exit" | "move";

type PhaseAwareEffect<Ctx, AllowedPhase extends PhaseName> = TransitionEffect<Ctx> & {
  debugName?: string;
  phases: readonly AllowedPhase[];
};

export type FadeEffectOptions = {
  value?: number;
  keyframes?: ValueKeyframe<number>[];
};

export type ScaleEffectOptions = {
  value?: ScaleValue;
  origin?: string;
  keyframes?: ValueKeyframe<ScaleValue>[];
};

export type BlurEffectOptions = {
  value?: BlurValue;
  keyframes?: ValueKeyframe<BlurValue>[];
};

export type TranslateEffectOptions = {
  value?: RelativePoint;
  keyframes?: ValueKeyframe<RelativePoint>[];
};

export type FlipEffectOptions = {
  scale?: boolean;
  origin?: string;
};

export type EnterEffect = PhaseAwareEffect<EnterOrExitContext, "enter" | "exit">;
export type ExitEffect = PhaseAwareEffect<EnterOrExitContext, "enter" | "exit">;
export type MoveEffect = PhaseAwareEffect<MoveTransitionContext, "move">;

function withPhases<Ctx, AllowedPhase extends PhaseName>(
  effect: TransitionEffect<Ctx> & { debugName?: string },
  phases: readonly AllowedPhase[],
): PhaseAwareEffect<Ctx, AllowedPhase> {
  return {
    ...effect,
    phases,
  };
}

function isExitContext(ctx: EnterOrExitContext): ctx is ExitTransitionContext {
  return "layoutMode" in ctx;
}

function toCssLength(value: BlurValue): string {
  return typeof value === "number" ? `${value}px` : value;
}

function normalizeFadeOptions(valueOrOptions: number | FadeEffectOptions | undefined): FadeEffectOptions {
  if (typeof valueOrOptions === "number" || valueOrOptions === undefined) {
    return { value: valueOrOptions };
  }
  return valueOrOptions;
}

function normalizeScaleOptions(valueOrOptions: ScaleValue | ScaleEffectOptions | undefined): ScaleEffectOptions {
  if (
    typeof valueOrOptions === "number" ||
    valueOrOptions === undefined ||
    ("x" in valueOrOptions && "y" in valueOrOptions)
  ) {
    return { value: valueOrOptions };
  }
  return valueOrOptions;
}

function normalizeBlurOptions(valueOrOptions: BlurValue | BlurEffectOptions | undefined): BlurEffectOptions {
  if (typeof valueOrOptions === "number" || typeof valueOrOptions === "string" || valueOrOptions === undefined) {
    return { value: valueOrOptions };
  }
  return valueOrOptions;
}

function normalizeTranslateOptions(valueOrOptions: RelativePoint | TranslateEffectOptions): TranslateEffectOptions {
  if ("x" in valueOrOptions && "y" in valueOrOptions) {
    return { value: valueOrOptions };
  }
  return valueOrOptions;
}

function resolveAxisValue(value: RelativePoint["x"], size: number): number {
  if (typeof value === "number") {
    return value;
  }

  const matched = /^(-?\d+(?:\.\d+)?)%$/.exec(value.trim());
  if (!matched) {
    throw new Error(`translate() percentage must be a valid percent string, received "${value}"`);
  }

  return (Number.parseFloat(matched[1] ?? "0") / 100) * size;
}

function resolveTranslateValue(value: RelativePoint, ctx: EnterOrExitContext): Point {
  return {
    x: resolveAxisValue(value.x, ctx.rect.width),
    y: resolveAxisValue(value.y, ctx.rect.height),
  };
}

export function fade(value?: number): EnterEffect;
export function fade(options: FadeEffectOptions): EnterEffect;
export function fade(valueOrOptions?: number | FadeEffectOptions): EnterEffect {
  const options = normalizeFadeOptions(valueOrOptions);

  return withPhases(
    createTransitionEffect("fade()", (ctx: EnterOrExitContext) => {
      const baseOpacity = getElementOpacity(ctx.element);
      const timeline = options.keyframes
        ? options.keyframes
        : isExitContext(ctx)
          ? [
              { offset: 0, value: 1 },
              { offset: 1, value: options.value ?? 0 },
            ]
          : [
              { offset: 0, value: options.value ?? 0 },
              { offset: 1, value: 1 },
            ];

      return timeline.map(({ offset, value }) => ({
        offset,
        opacity: value * baseOpacity,
      }));
    }),
    ["enter", "exit"],
  );
}

export function scale(value?: ScaleValue): EnterEffect;
export function scale(options: ScaleEffectOptions): EnterEffect;
export function scale(valueOrOptions?: ScaleValue | ScaleEffectOptions): EnterEffect {
  const options = normalizeScaleOptions(valueOrOptions);

  return withPhases(
    createTransitionEffect("scale()", (ctx: EnterOrExitContext) => {
      const timeline = options.keyframes
        ? options.keyframes.map(({ offset, value }) => ({ offset, value: toScale(value, 1) }))
        : isExitContext(ctx)
          ? [
              { offset: 0, value: toScale(1, 1) },
              { offset: 1, value: toScale(options.value, 0.96) },
            ]
          : [
              { offset: 0, value: toScale(options.value, 0.96) },
              { offset: 1, value: toScale(1, 1) },
            ];

      return timeline.map(({ offset, value }) => ({
        offset,
        transformOrigin: options.origin ?? DEFAULT_TRANSFORM_ORIGIN,
        transform: {
          scale: value,
        },
      }));
    }),
    ["enter", "exit"],
  );
}

export function blur(value?: BlurValue): EnterEffect;
export function blur(options: BlurEffectOptions): EnterEffect;
export function blur(valueOrOptions?: BlurValue | BlurEffectOptions): EnterEffect {
  const options = normalizeBlurOptions(valueOrOptions);

  return withPhases(
    createTransitionEffect("blur()", (ctx: EnterOrExitContext) => {
      const timeline = options.keyframes
        ? options.keyframes.map(({ offset, value }) => ({ offset, value: toCssLength(value) }))
        : isExitContext(ctx)
          ? [
              { offset: 0, value: "0px" },
              { offset: 1, value: toCssLength(options.value ?? 8) },
            ]
          : [
              { offset: 0, value: toCssLength(options.value ?? 8) },
              { offset: 1, value: "0px" },
            ];

      return timeline.map(({ offset, value }) => ({
        offset,
        filter: {
          blur: value,
        },
      }));
    }),
    ["enter", "exit"],
  );
}

export function translate(value: RelativePoint): EnterEffect;
export function translate(options: TranslateEffectOptions): EnterEffect;
export function translate(valueOrOptions: RelativePoint | TranslateEffectOptions): EnterEffect {
  const options = normalizeTranslateOptions(valueOrOptions);

  return withPhases(
    createTransitionEffect("translate()", (ctx: EnterOrExitContext) => {
      const target = resolveTranslateValue(options.value ?? { x: 0, y: 0 }, ctx);
      const timeline = options.keyframes
        ? options.keyframes.map(({ offset, value }) => ({
            offset,
            value: isExitContext(ctx)
              ? addPoints(ctx.anchorDelta, resolveTranslateValue(value, ctx))
              : resolveTranslateValue(value, ctx),
          }))
        : isExitContext(ctx)
          ? [
              { offset: 0, value: ctx.anchorDelta },
              { offset: 1, value: addPoints(ctx.anchorDelta, target) },
            ]
          : [
              { offset: 0, value: target },
              { offset: 1, value: { x: 0, y: 0 } },
            ];

      return timeline.map(({ offset, value }) => ({
        offset,
        transform: {
          translate: value,
        },
      }));
    }),
    ["enter", "exit"],
  );
}

export function flip(options: FlipEffectOptions = {}): MoveEffect {
  return withPhases(
    createTransitionEffect("flip()", (ctx: MoveTransitionContext) => {
      const compensatedDelta = {
        x: ctx.delta.x + ctx.anchorDelta.x,
        y: ctx.delta.y + ctx.anchorDelta.y,
      };

      return [
        {
          offset: 0,
          transformOrigin: options.origin ?? DEFAULT_MOVE_TRANSFORM_ORIGIN,
          transform: {
            translate: compensatedDelta,
            ...(options.scale === false ? {} : { scale: ctx.scale }),
          },
        },
        {
          offset: 1,
          transformOrigin: options.origin ?? DEFAULT_MOVE_TRANSFORM_ORIGIN,
          transform: {
            translate: { x: 0, y: 0 },
            ...(options.scale === false ? {} : { scale: { x: 1, y: 1 } }),
          },
        },
      ];
    }),
    ["move"],
  );
}

export const effects = {
  fade,
  scale,
  blur,
  translate,
  flip,
} as const;
