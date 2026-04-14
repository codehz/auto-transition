import type {
  CompiledTransitionPlugin,
  EffectFilter,
  EnterTransitionContext,
  ExitTransitionContext,
  MoveGeometry,
  MoveTransitionContext,
  Point,
  TransitionBaseContext,
  TransitionEffect,
  TransitionPhaseDefinition,
  TransitionPhaseLike,
  TransitionPlugin,
  TransitionTiming,
} from "./transitionTypes.ts";

const DEFAULT_TRANSFORM_ORIGIN = "50% 50%";
const DEFAULT_MOVE_TRANSFORM_ORIGIN = "0 0";

type ScaleValue = number | MoveGeometry["scale"];
type Axis = "x" | "y";
type Direction = 1 | -1;

type TimelineEntry<T> = {
  offset: number;
  value: T;
};

type PhaseArgument<Ctx> = TransitionEffect<Ctx> | TransitionTiming<Ctx>;

type ResolvedAtomicValues = {
  opacity?: number;
  transformOrigin?: string;
  translate?: Point;
  scale?: MoveGeometry["scale"];
  blur?: string;
  style: Partial<Keyframe>;
};

type AtomicOwnership = {
  hasTranslate: boolean;
  hasScale: boolean;
  hasBlur: boolean;
};

type CommonValueOptions<T> = {
  from?: T;
  to?: T;
  keyframes?: Array<{
    offset: number;
    value: T;
  }>;
};

export type CommonFadeEffectOptions = CommonValueOptions<number>;

export type CommonScaleEffectOptions = CommonValueOptions<ScaleValue> & {
  transformOrigin?: string;
};

export type CommonBlurEffectOptions = CommonValueOptions<string>;

export type EnterSlideEffectOptions = {
  axis?: Axis;
  direction?: Direction;
  distance?: number;
  from?: Point;
  to?: Point;
};

export type ExitAnchorTranslateEffectOptions = {
  includeAnchorDelta?: boolean;
  axis?: Axis;
  direction?: Direction;
  distance?: number;
};

export type MoveFlipTranslateEffectOptions = {
  includeAnchorDelta?: boolean;
};

export type MoveFlipScaleEffectOptions = {
  transformOrigin?: string;
};

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
  peakOffset?: number;
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
export type ExitFadeScaleOptions = ExitAbsoluteFadeScaleOptions;
export type ExitFadeOptions = ExitAbsoluteFadeOptions;
export type ExitSlideFadeOptions = ExitAbsoluteSlideFadeOptions;
export type ExitShrinkOptions = ExitAbsoluteShrinkOptions;

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

function buildFilter(filter: EffectFilter | undefined, ownership: AtomicOwnership): string | undefined {
  if (!ownership.hasBlur) {
    return undefined;
  }
  const blur = filter?.blur ?? "0px";
  return `blur(${blur})`;
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

function resolveTransitionOptions<Ctx>(
  options: TransitionTiming<Ctx> | undefined,
  ctx: Ctx,
): KeyframeAnimationOptions | undefined {
  return typeof options === "function" ? options(ctx) : options;
}

function parseOpacity(value: string | undefined): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const opacity = Number.parseFloat(value);
  return Number.isFinite(opacity) ? opacity : undefined;
}

function getElementOpacity(element: Element): number {
  if (typeof globalThis.getComputedStyle === "function") {
    try {
      const computedOpacity = parseOpacity(globalThis.getComputedStyle(element).opacity);
      if (computedOpacity != null) {
        return computedOpacity;
      }
    } catch {
      // Ignore environments where getComputedStyle only accepts real DOM elements.
    }
  }

  if ("style" in element) {
    const inlineOpacity = parseOpacity((element as { style?: { opacity?: string } }).style?.opacity);
    if (inlineOpacity != null) {
      return inlineOpacity;
    }
  }

  return 1;
}

function relativeOpacity(opacityFactor: number, baseOpacity: number): number {
  return opacityFactor * baseOpacity;
}

function createTransitionEffect<Ctx>(build: TransitionEffect<Ctx>["build"]): TransitionEffect<Ctx> {
  return { build };
}

function collectFieldEntries<T>(
  target: Map<string, TimelineEntry<unknown>[]>,
  ownership: Map<string, number>,
  effectIndex: number,
  field: string,
  value: T | undefined,
  offset: number,
) {
  if (value === undefined) {
    return;
  }

  const owner = ownership.get(field);
  if (owner != null && owner !== effectIndex) {
    throw new Error(`Transition effects conflict on "${field}"`);
  }
  ownership.set(field, effectIndex);

  const entries = target.get(field) ?? [];
  entries.push({ offset, value });
  target.set(field, entries);
}

function resolveTimelineValue<T>(entries: TimelineEntry<T>[] | undefined, offset: number): T | undefined {
  if (!entries || entries.length === 0) {
    return undefined;
  }

  let next: TimelineEntry<T> | undefined;
  let previous: TimelineEntry<T> | undefined;

  for (const entry of entries) {
    if (entry.offset === offset) {
      return entry.value;
    }
    if (entry.offset < offset) {
      previous = entry;
      continue;
    }
    next = entry;
    break;
  }

  if (previous) {
    return previous.value;
  }
  return next?.value;
}

function compileEffectFrames<Ctx>(
  ctx: Ctx,
  definition: TransitionPhaseDefinition<Ctx>,
): {
  keyframes: Keyframe[];
  ownership: AtomicOwnership;
} {
  const fieldTimelines = new Map<string, TimelineEntry<unknown>[]>();
  const ownership = new Map<string, number>();
  const offsets = new Set<number>([0, 1]);

  definition.effects.forEach((effect, effectIndex) => {
    const frames = effect.build(ctx);
    for (const frame of frames) {
      offsets.add(frame.offset);

      collectFieldEntries(fieldTimelines, ownership, effectIndex, "opacity", frame.opacity, frame.offset);
      collectFieldEntries(
        fieldTimelines,
        ownership,
        effectIndex,
        "transformOrigin",
        frame.transformOrigin,
        frame.offset,
      );
      collectFieldEntries(
        fieldTimelines,
        ownership,
        effectIndex,
        "transform.translate",
        frame.transform?.translate,
        frame.offset,
      );
      collectFieldEntries(
        fieldTimelines,
        ownership,
        effectIndex,
        "transform.scale",
        frame.transform?.scale,
        frame.offset,
      );
      collectFieldEntries(fieldTimelines, ownership, effectIndex, "filter.blur", frame.filter?.blur, frame.offset);

      for (const [styleKey, styleValue] of Object.entries(frame.style ?? {})) {
        collectFieldEntries(fieldTimelines, ownership, effectIndex, `style.${styleKey}`, styleValue, frame.offset);
      }
    }
  });

  const sortedOffsets = Array.from(offsets).sort((a, b) => a - b);
  const atomicOwnership = {
    hasTranslate: ownership.has("transform.translate"),
    hasScale: ownership.has("transform.scale"),
    hasBlur: ownership.has("filter.blur"),
  };

  const keyframes = sortedOffsets.map((offset) => {
    const values: ResolvedAtomicValues = {
      opacity: resolveTimelineValue(fieldTimelines.get("opacity") as TimelineEntry<number>[] | undefined, offset),
      transformOrigin: resolveTimelineValue(
        fieldTimelines.get("transformOrigin") as TimelineEntry<string>[] | undefined,
        offset,
      ),
      translate: resolveTimelineValue(
        fieldTimelines.get("transform.translate") as TimelineEntry<Point>[] | undefined,
        offset,
      ),
      scale: resolveTimelineValue(
        fieldTimelines.get("transform.scale") as TimelineEntry<MoveGeometry["scale"]>[] | undefined,
        offset,
      ),
      blur: resolveTimelineValue(fieldTimelines.get("filter.blur") as TimelineEntry<string>[] | undefined, offset),
      style: {},
    };

    for (const [field, entries] of fieldTimelines) {
      if (!field.startsWith("style.")) {
        continue;
      }
      const styleKey = field.slice("style.".length) as keyof Keyframe;
      const styleValue = resolveTimelineValue(entries, offset);
      if (styleValue !== undefined) {
        values.style[styleKey] = styleValue as Keyframe[keyof Keyframe];
      }
    }

    const keyframe: Keyframe = {
      ...values.style,
      offset,
    };

    if (values.opacity !== undefined) {
      keyframe.opacity = values.opacity;
    }
    if (values.transformOrigin !== undefined) {
      keyframe.transformOrigin = values.transformOrigin;
    }

    const transform = buildTransform({
      translate: values.translate,
      scale: values.scale,
      includeTranslateWhenZero: atomicOwnership.hasTranslate,
      includeScaleWhenIdentity: atomicOwnership.hasScale,
    });
    if (transform) {
      keyframe.transform = transform;
    }

    const filter = buildFilter(values.blur == null ? undefined : { blur: values.blur }, atomicOwnership);
    if (filter) {
      keyframe.filter = filter;
    }

    return keyframe;
  });

  return {
    keyframes,
    ownership: atomicOwnership,
  };
}

function createTransitionAnimation<Ctx extends TransitionBaseContext>(
  ctx: Ctx,
  definition: TransitionPhaseDefinition<Ctx>,
): Animation {
  const { keyframes } = compileEffectFrames(ctx, definition);
  return ctx.element.animate(keyframes, resolveTransitionOptions(definition.options, ctx));
}

function isTransitionPhaseDefinition<Ctx>(phase: TransitionPhaseLike<Ctx>): phase is TransitionPhaseDefinition<Ctx> {
  return typeof phase !== "function";
}

function compileTransitionPhase<Ctx extends TransitionBaseContext>(
  phase: TransitionPhaseLike<Ctx> | undefined,
): ((ctx: Ctx) => Animation) | undefined {
  if (!phase) {
    return undefined;
  }
  if (!isTransitionPhaseDefinition(phase)) {
    return phase;
  }
  return (ctx: Ctx) => createTransitionAnimation(ctx, phase);
}

function toValueTimeline<T>(
  options: CommonValueOptions<T>,
  fallbackFrom: T,
  fallbackTo: T,
): Array<{ offset: number; value: T }> {
  if (options.keyframes) {
    return options.keyframes;
  }
  return [
    { offset: 0, value: options.from ?? fallbackFrom },
    { offset: 1, value: options.to ?? fallbackTo },
  ];
}

function splitPhaseArguments<Ctx>(args: PhaseArgument<Ctx>[]): {
  effects: TransitionEffect<Ctx>[];
  options: TransitionTiming<Ctx> | undefined;
} {
  if (args.length === 0) {
    return { effects: [], options: undefined };
  }

  const last = args[args.length - 1];
  if (typeof last === "object" && last != null && "build" in last) {
    return { effects: args as TransitionEffect<Ctx>[], options: undefined };
  }

  return {
    effects: args.slice(0, -1) as TransitionEffect<Ctx>[],
    options: last as TransitionTiming<Ctx>,
  };
}

function createPhaseDefinition<Ctx>(effects: TransitionEffect<Ctx>[], options?: TransitionTiming<Ctx>) {
  return {
    effects,
    options,
  } satisfies TransitionPhaseDefinition<Ctx>;
}

function createAbsoluteBaseEffect(): TransitionEffect<ExitTransitionContext> {
  return createTransitionEffect(({ rect }) => [
    {
      offset: 0,
      style: {
        position: "absolute",
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: "0",
        top: `${rect.y}px`,
        left: `${rect.x}px`,
      },
    },
    {
      offset: 1,
      style: {
        position: "absolute",
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: "0",
        top: `${rect.y}px`,
        left: `${rect.x}px`,
      },
    },
  ]);
}

export const transitionEffects = {
  common: {
    fade(options: CommonFadeEffectOptions = {}): TransitionEffect<TransitionBaseContext> {
      return createTransitionEffect(({ element }) => {
        const baseOpacity = getElementOpacity(element);
        return toValueTimeline(options, 0, 1).map(({ offset, value }) => ({
          offset,
          opacity: relativeOpacity(value, baseOpacity),
        }));
      });
    },
    scale(options: CommonScaleEffectOptions = {}): TransitionEffect<TransitionBaseContext> {
      return createTransitionEffect(() =>
        toValueTimeline(options, 0.96, 1).map(({ offset, value }) => ({
          offset,
          transformOrigin: options.transformOrigin ?? DEFAULT_TRANSFORM_ORIGIN,
          transform: {
            scale: toScale(value, 1),
          },
        })),
      );
    },
    blur(options: CommonBlurEffectOptions = {}): TransitionEffect<TransitionBaseContext> {
      return createTransitionEffect(() =>
        toValueTimeline(options, "8px", "0px").map(({ offset, value }) => ({
          offset,
          filter: {
            blur: value,
          },
        })),
      );
    },
  },
  enter: {
    slide({
      axis = "y",
      direction = 1,
      distance = 16,
      from,
      to = { x: 0, y: 0 },
    }: EnterSlideEffectOptions = {}): TransitionEffect<EnterTransitionContext> {
      const start = from ?? directionalOffset(distance, axis, direction);
      if (isZeroPoint(start) && isZeroPoint(to)) {
        return createTransitionEffect(() => []);
      }
      return createTransitionEffect(() => [
        {
          offset: 0,
          transform: {
            translate: start,
          },
        },
        {
          offset: 1,
          transform: {
            translate: to,
          },
        },
      ]);
    },
  },
  exit: {
    anchorTranslate({
      includeAnchorDelta = true,
      axis = "y",
      direction = -1,
      distance = 0,
    }: ExitAnchorTranslateEffectOptions = {}): TransitionEffect<ExitTransitionContext> {
      return createTransitionEffect(({ anchorDelta }) => {
        const baseTranslate = includeAnchorDelta ? anchorDelta : { x: 0, y: 0 };
        const endTranslate = addPoints(baseTranslate, directionalOffset(distance, axis, direction));
        if (isZeroPoint(baseTranslate) && isZeroPoint(endTranslate)) {
          return [];
        }
        return [
          {
            offset: 0,
            transform: {
              translate: baseTranslate,
            },
          },
          {
            offset: 1,
            transform: {
              translate: endTranslate,
            },
          },
        ];
      });
    },
  },
  move: {
    flipTranslate({
      includeAnchorDelta = true,
    }: MoveFlipTranslateEffectOptions = {}): TransitionEffect<MoveTransitionContext> {
      return createTransitionEffect(({ delta, anchorDelta }) => {
        const compensatedDelta = {
          x: delta.x + (includeAnchorDelta ? anchorDelta.x : 0),
          y: delta.y + (includeAnchorDelta ? anchorDelta.y : 0),
        };

        return [
          {
            offset: 0,
            transform: {
              translate: compensatedDelta,
            },
          },
          {
            offset: 1,
            transform: {
              translate: { x: 0, y: 0 },
            },
          },
        ];
      });
    },
    flipScale({
      transformOrigin = DEFAULT_MOVE_TRANSFORM_ORIGIN,
    }: MoveFlipScaleEffectOptions = {}): TransitionEffect<MoveTransitionContext> {
      return createTransitionEffect(({ scale }) => [
        {
          offset: 0,
          transformOrigin,
          transform: {
            scale,
          },
        },
        {
          offset: 1,
          transformOrigin,
          transform: {
            scale: { x: 1, y: 1 },
          },
        },
      ]);
    },
  },
} as const;

export const transitionPhases = {
  enter<Ctx extends EnterTransitionContext>(...args: PhaseArgument<Ctx>[]): TransitionPhaseDefinition<Ctx> {
    const { effects, options } = splitPhaseArguments(args);
    return createPhaseDefinition(effects, options);
  },
  exit: {
    flow<Ctx extends ExitTransitionContext>(...args: PhaseArgument<Ctx>[]): TransitionPhaseDefinition<Ctx> {
      const { effects, options } = splitPhaseArguments(args);
      return createPhaseDefinition(effects, options);
    },
    absolute<Ctx extends ExitTransitionContext>(...args: PhaseArgument<Ctx>[]): TransitionPhaseDefinition<Ctx> {
      const { effects, options } = splitPhaseArguments(args);
      return createPhaseDefinition([createAbsoluteBaseEffect() as TransitionEffect<Ctx>, ...effects], options);
    },
  },
  move<Ctx extends MoveTransitionContext>(...args: PhaseArgument<Ctx>[]): TransitionPhaseDefinition<Ctx> {
    const { effects, options } = splitPhaseArguments(args);
    return createPhaseDefinition(effects, options);
  },
} as const;

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
    fade(options: EnterFadeOptions = {}): TransitionPhaseDefinition<EnterTransitionContext> {
      const {
        duration = 250,
        easing = "ease-out",
        fromOpacity = 0,
        toOpacity = 1,
        fromTranslate,
        toTranslate,
      } = options;

      const effects: TransitionEffect<EnterTransitionContext>[] = [
        transitionEffects.common.fade({ from: fromOpacity, to: toOpacity }) as TransitionEffect<EnterTransitionContext>,
      ];

      if (fromTranslate || toTranslate) {
        effects.push(
          transitionEffects.enter.slide({
            from: fromTranslate,
            to: toTranslate,
            distance: 0,
          }),
        );
      }

      return transitionPhases.enter(...effects, { duration, easing });
    },
    fadeScale(options: EnterFadeScaleOptions = {}): TransitionPhaseDefinition<EnterTransitionContext> {
      const {
        duration = 250,
        easing = "ease-out",
        fromOpacity = 0,
        toOpacity = 1,
        fromScale = 0.96,
        endScale = 1,
        fromTranslate,
        toTranslate,
        transformOrigin = DEFAULT_TRANSFORM_ORIGIN,
      } = options;

      const effects: TransitionEffect<EnterTransitionContext>[] = [
        transitionEffects.common.fade({ from: fromOpacity, to: toOpacity }) as TransitionEffect<EnterTransitionContext>,
        transitionEffects.common.scale({
          from: fromScale,
          to: endScale,
          transformOrigin,
        }) as TransitionEffect<EnterTransitionContext>,
      ];

      if (fromTranslate || toTranslate) {
        effects.push(
          transitionEffects.enter.slide({
            from: fromTranslate,
            to: toTranslate,
            distance: 0,
          }),
        );
      }

      return transitionPhases.enter(...effects, { duration, easing });
    },
    slideFade(options: EnterSlideFadeOptions = {}): TransitionPhaseDefinition<EnterTransitionContext> {
      const {
        axis = "y",
        direction = 1,
        distance = 16,
        duration = 250,
        easing = "ease-out",
        fromOpacity = 0,
        toOpacity = 1,
      } = options;

      return transitionPhases.enter(
        transitionEffects.common.fade({ from: fromOpacity, to: toOpacity }) as TransitionEffect<EnterTransitionContext>,
        transitionEffects.enter.slide({
          axis,
          direction,
          distance,
        }),
        { duration, easing },
      );
    },
    pop(options: EnterPopOptions = {}): TransitionPhaseDefinition<EnterTransitionContext> {
      const {
        duration = 280,
        easing = "cubic-bezier(0.16, 1, 0.3, 1)",
        fromOpacity = 0,
        toOpacity = 1,
        fromScale = 0.9,
        peakScale = 1.03,
        peakOffset = 0.7,
        fromTranslate,
        toTranslate,
        transformOrigin = DEFAULT_TRANSFORM_ORIGIN,
      } = options;

      const effects: TransitionEffect<EnterTransitionContext>[] = [
        transitionEffects.common.fade({
          keyframes: [
            { offset: 0, value: fromOpacity },
            { offset: peakOffset, value: toOpacity },
            { offset: 1, value: toOpacity },
          ],
        }) as TransitionEffect<EnterTransitionContext>,
        transitionEffects.common.scale({
          keyframes: [
            { offset: 0, value: fromScale },
            { offset: peakOffset, value: peakScale },
            { offset: 1, value: 1 },
          ],
          transformOrigin,
        }) as TransitionEffect<EnterTransitionContext>,
      ];

      if (fromTranslate || toTranslate) {
        effects.push(
          transitionEffects.enter.slide({
            from: fromTranslate,
            to: toTranslate,
            distance: 0,
          }),
        );
      }

      return transitionPhases.enter(...effects, { duration, easing });
    },
  },
  exit: {
    fade(options: ExitFadeOptions = {}): TransitionPhaseDefinition<ExitTransitionContext> {
      const { duration = 250, easing = "ease-in", fromOpacity = 1, toOpacity = 0, includeAnchorDelta = true } = options;

      return transitionPhases.exit.flow(
        transitionEffects.common.fade({ from: fromOpacity, to: toOpacity }) as TransitionEffect<ExitTransitionContext>,
        transitionEffects.exit.anchorTranslate({ includeAnchorDelta }),
        { duration, easing },
      );
    },
    fadeScale(options: ExitFadeScaleOptions = {}): TransitionPhaseDefinition<ExitTransitionContext> {
      const {
        duration = 250,
        easing = "ease-in",
        fromOpacity = 1,
        toOpacity = 0,
        fromScale = 1,
        endScale = 0.96,
        includeAnchorDelta = true,
        transformOrigin = DEFAULT_TRANSFORM_ORIGIN,
      } = options;

      return transitionPhases.exit.flow(
        transitionEffects.common.fade({ from: fromOpacity, to: toOpacity }) as TransitionEffect<ExitTransitionContext>,
        transitionEffects.exit.anchorTranslate({ includeAnchorDelta }),
        transitionEffects.common.scale({
          from: fromScale,
          to: endScale,
          transformOrigin,
        }) as TransitionEffect<ExitTransitionContext>,
        { duration, easing },
      );
    },
    slideFade(options: ExitSlideFadeOptions = {}): TransitionPhaseDefinition<ExitTransitionContext> {
      const {
        axis = "y",
        direction = -1,
        distance = 16,
        duration = 220,
        easing = "ease-in",
        fromOpacity = 1,
        toOpacity = 0,
        includeAnchorDelta = true,
      } = options;

      return transitionPhases.exit.flow(
        transitionEffects.common.fade({ from: fromOpacity, to: toOpacity }) as TransitionEffect<ExitTransitionContext>,
        transitionEffects.exit.anchorTranslate({
          includeAnchorDelta,
          axis,
          direction,
          distance,
        }),
        { duration, easing },
      );
    },
    shrink(options: ExitShrinkOptions = {}): TransitionPhaseDefinition<ExitTransitionContext> {
      return transitionPresets.exit.fadeScale({
        duration: 220,
        easing: "ease-in",
        endScale: 0.9,
        ...options,
      });
    },
    absoluteFade(options: ExitAbsoluteFadeOptions = {}): TransitionPhaseDefinition<ExitTransitionContext> {
      const { duration = 250, easing = "ease-in", fromOpacity = 1, toOpacity = 0, includeAnchorDelta = true } = options;

      return transitionPhases.exit.absolute(
        transitionEffects.common.fade({ from: fromOpacity, to: toOpacity }) as TransitionEffect<ExitTransitionContext>,
        transitionEffects.exit.anchorTranslate({ includeAnchorDelta }),
        { duration, easing },
      );
    },
    absoluteFadeScale(options: ExitAbsoluteFadeScaleOptions = {}): TransitionPhaseDefinition<ExitTransitionContext> {
      const {
        duration = 250,
        easing = "ease-in",
        fromOpacity = 1,
        toOpacity = 0,
        fromScale = 1,
        endScale = 0.96,
        includeAnchorDelta = true,
        transformOrigin = DEFAULT_TRANSFORM_ORIGIN,
      } = options;

      return transitionPhases.exit.absolute(
        transitionEffects.common.fade({ from: fromOpacity, to: toOpacity }) as TransitionEffect<ExitTransitionContext>,
        transitionEffects.exit.anchorTranslate({ includeAnchorDelta }),
        transitionEffects.common.scale({
          from: fromScale,
          to: endScale,
          transformOrigin,
        }) as TransitionEffect<ExitTransitionContext>,
        { duration, easing },
      );
    },
    absoluteSlideFade(options: ExitAbsoluteSlideFadeOptions = {}): TransitionPhaseDefinition<ExitTransitionContext> {
      const {
        axis = "y",
        direction = -1,
        distance = 16,
        duration = 220,
        easing = "ease-in",
        fromOpacity = 1,
        toOpacity = 0,
        includeAnchorDelta = true,
      } = options;

      return transitionPhases.exit.absolute(
        transitionEffects.common.fade({ from: fromOpacity, to: toOpacity }) as TransitionEffect<ExitTransitionContext>,
        transitionEffects.exit.anchorTranslate({
          includeAnchorDelta,
          axis,
          direction,
          distance,
        }),
        { duration, easing },
      );
    },
    absoluteShrink(options: ExitAbsoluteShrinkOptions = {}): TransitionPhaseDefinition<ExitTransitionContext> {
      return transitionPresets.exit.absoluteFadeScale({
        duration: 220,
        easing: "ease-in",
        endScale: 0.9,
        ...options,
      });
    },
  },
  move: {
    flip(options: MoveFlipOptions = {}): TransitionPhaseDefinition<MoveTransitionContext> {
      const {
        duration = 250,
        easing = "ease-in",
        includeAnchorDelta = true,
        includeScale = true,
        transformOrigin = DEFAULT_MOVE_TRANSFORM_ORIGIN,
      } = options;

      const effects: TransitionEffect<MoveTransitionContext>[] = [
        transitionEffects.move.flipTranslate({ includeAnchorDelta }),
      ];

      if (includeScale) {
        effects.push(transitionEffects.move.flipScale({ transformOrigin }));
      }

      return transitionPhases.move(...effects, { duration, easing });
    },
    translate(options: MoveTranslateOptions = {}): TransitionPhaseDefinition<MoveTransitionContext> {
      return transitionPresets.move.flip({
        duration: 220,
        easing: "ease-out",
        ...options,
        includeScale: false,
      });
    },
    smooth(options: MoveSmoothOptions = {}): TransitionPhaseDefinition<MoveTransitionContext> {
      return transitionPresets.move.flip({
        duration: 320,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        ...options,
      });
    },
  },
} as const;

const defaultTransition = defineTransition({
  enter: transitionPresets.enter.fade(),
  move: transitionPresets.move.flip(),
});
const defaultAbsoluteExit = defineTransition({
  exit: transitionPresets.exit.absoluteFade(),
});
const defaultFlowExit = defineTransition({
  exit: transitionPresets.exit.fade(),
});

export function defaultEnterTransition(ctx: EnterTransitionContext): Animation {
  return defaultTransition.enter!(ctx);
}

export function defaultExitTransition(ctx: ExitTransitionContext): Animation {
  return ctx.layoutMode === "flow" ? defaultFlowExit.exit!(ctx) : defaultAbsoluteExit.exit!(ctx);
}

export function defaultMoveTransition(ctx: MoveTransitionContext): Animation {
  return defaultTransition.move!(ctx);
}
