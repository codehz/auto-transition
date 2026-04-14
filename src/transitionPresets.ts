import type {
  CompiledTransitionPlugin,
  EffectFilter,
  ExitTransitionContext,
  MoveGeometry,
  Point,
  TransitionBaseContext,
  TransitionEffect,
  TransitionPhaseDefinition,
  TransitionPhaseLike,
  TransitionPlugin,
  TransitionTiming,
} from "./transitionTypes.ts";

export const DEFAULT_TRANSFORM_ORIGIN = "50% 50%";
export const DEFAULT_MOVE_TRANSFORM_ORIGIN = "0 0";

type TimelineEntry<T> = {
  offset: number;
  value: T;
};

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

type NamedTransitionEffect<Ctx> = TransitionEffect<Ctx> & {
  debugName?: string;
};

type OwnershipRecord = {
  effectIndex: number;
  label: string;
};

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

export function getElementOpacity(element: Element): number {
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

export function toScale(value: number | MoveGeometry["scale"] | undefined, fallback: number): MoveGeometry["scale"] {
  if (typeof value === "number") {
    return { x: value, y: value };
  }
  if (value) {
    return value;
  }
  return { x: fallback, y: fallback };
}

export function addPoints(a: Point, b: Point): Point {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
  };
}

export function createTransitionEffect<Ctx>(
  debugName: string,
  build: TransitionEffect<Ctx>["build"],
): NamedTransitionEffect<Ctx> {
  return { build, debugName };
}

function collectFieldEntries<T>(
  target: Map<string, TimelineEntry<unknown>[]>,
  ownership: Map<string, OwnershipRecord>,
  effectIndex: number,
  effectLabel: string,
  field: string,
  value: T | undefined,
  offset: number,
) {
  if (value === undefined) {
    return;
  }

  const owner = ownership.get(field);
  if (owner && owner.effectIndex !== effectIndex) {
    throw new Error(`${effectLabel} conflicts with another ${owner.label} effect`);
  }
  ownership.set(field, { effectIndex, label: effectLabel });

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
  const ownership = new Map<string, OwnershipRecord>();
  const offsets = new Set<number>([0, 1]);

  definition.effects.forEach((effect, effectIndex) => {
    const namedEffect = effect as NamedTransitionEffect<Ctx>;
    const effectLabel = namedEffect.debugName ?? "effect()";
    const frames = effect.build(ctx);
    for (const frame of frames) {
      offsets.add(frame.offset);

      collectFieldEntries(fieldTimelines, ownership, effectIndex, effectLabel, "opacity", frame.opacity, frame.offset);
      collectFieldEntries(
        fieldTimelines,
        ownership,
        effectIndex,
        effectLabel,
        "transformOrigin",
        frame.transformOrigin,
        frame.offset,
      );
      collectFieldEntries(
        fieldTimelines,
        ownership,
        effectIndex,
        effectLabel,
        "transform.translate",
        frame.transform?.translate,
        frame.offset,
      );
      collectFieldEntries(
        fieldTimelines,
        ownership,
        effectIndex,
        effectLabel,
        "transform.scale",
        frame.transform?.scale,
        frame.offset,
      );
      collectFieldEntries(
        fieldTimelines,
        ownership,
        effectIndex,
        effectLabel,
        "filter.blur",
        frame.filter?.blur,
        frame.offset,
      );

      for (const [styleKey, styleValue] of Object.entries(frame.style ?? {})) {
        collectFieldEntries(
          fieldTimelines,
          ownership,
          effectIndex,
          effectLabel,
          `style.${styleKey}`,
          styleValue,
          frame.offset,
        );
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

export function createTransitionAnimation<Ctx extends TransitionBaseContext>(
  ctx: Ctx,
  definition: TransitionPhaseDefinition<Ctx>,
): Animation {
  const { keyframes } = compileEffectFrames(ctx, definition);
  return ctx.element.animate(keyframes, resolveTransitionOptions(definition.options, ctx));
}

export function createExitLayoutEffect(): TransitionEffect<ExitTransitionContext> {
  return createTransitionEffect("exitLayout()", ({ rect, layoutMode }) => {
    if (layoutMode !== "absolute") {
      return [];
    }

    return [
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
    ];
  });
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
