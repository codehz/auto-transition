import { describe, expect, test } from "bun:test";
import {
  buildEnterContext,
  buildExitContext,
  buildMoveContext,
  defaultEnterTransition,
  defaultExitTransition,
  defaultMoveTransition,
  defineTransition,
  getMoveGeometry,
  getScaleFactor,
  transitionEffects,
  transitionPhases,
  transitionPresets,
  type CompiledTransitionPlugin,
  type ParentBounds,
  type Point,
  type Rect,
  type TransitionPlugin,
} from "./AutoTransition.tsx";
import { planBatchAnimations, type BatchSnapshot, type PendingExitRecord } from "./batchPlan.ts";

const element = { id: "demo" } as unknown as Element;
const parent: ParentBounds = { width: 300, height: 200 };
const currentRect: Rect = { x: 80, y: 60, width: 120, height: 50 };
const previousRect: Rect = { x: 40, y: 20, width: 180, height: 90 };
const viewportRect: Rect = { x: 180, y: 160, width: 120, height: 50 };
const anchorDelta: Point = { x: 48, y: 36 };

function createAnimatedElement() {
  const calls: { keyframes: Keyframe[] | PropertyIndexedKeyframes | null; options: KeyframeAnimationOptions }[] = [];
  const animatedElement = {
    animate(keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: KeyframeAnimationOptions) {
      calls.push({ keyframes, options: options ?? {} });
      return { finished: Promise.resolve() } as unknown as Animation;
    },
  } as unknown as Element;

  return { animatedElement, calls };
}

function withMockedComputedOpacity(opacity: string, run: () => void) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");

  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    writable: true,
    value: () => ({ opacity }),
  });

  try {
    run();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "getComputedStyle", originalDescriptor);
    } else {
      delete (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle;
    }
  }
}

describe("buildExitContext", () => {
  test("keeps element geometry relative to the measured parent", () => {
    const context = buildExitContext(element, currentRect, parent);

    expect(context.element).toBe(element);
    expect(context.parent).toEqual(parent);
    expect(context.rect).toEqual(currentRect);
    expect(context.viewportRect).toEqual(currentRect);
    expect(context.anchorDelta).toEqual({ x: 0, y: 0 });
  });

  test("keeps viewport geometry and anchor compensation when provided", () => {
    const context = buildExitContext(element, currentRect, parent, {
      viewportRect,
      anchorDelta,
    });

    expect(context.viewportRect).toEqual(viewportRect);
    expect(context.anchorDelta).toEqual(anchorDelta);
  });
});

describe("buildMoveContext", () => {
  test("keeps geometry on the same measurement basis", () => {
    const context = buildMoveContext(element, currentRect, previousRect, parent);

    expect(context.element).toBe(element);
    expect(context.parent).toEqual(parent);
    expect(context.current).toEqual(currentRect);
    expect(context.previous).toEqual(previousRect);
    expect(context.delta).toEqual({ x: -40, y: -40 });
    expect(context.anchorDelta).toEqual({ x: 0, y: 0 });
    expect(context.scale).toEqual({ x: 1.5, y: 1.8 });
  });

  test("includes parent anchor compensation when provided", () => {
    const context = buildMoveContext(element, currentRect, previousRect, parent, { anchorDelta });

    expect(context.delta).toEqual({ x: -40, y: -40 });
    expect(context.anchorDelta).toEqual(anchorDelta);
  });
});

describe("TransitionPlugin contexts", () => {
  test("custom plugins can consume precomputed move geometry directly", () => {
    const seen: string[] = [];
    const plugin: CompiledTransitionPlugin = {
      enter(ctx) {
        expect(ctx.element).toBe(element);
        expect(ctx.parent).toEqual(parent);
        expect(ctx.rect).toEqual(currentRect);
        seen.push("enter");
        return {} as Animation;
      },
      exit(ctx) {
        expect(ctx.rect).toEqual(currentRect);
        expect(ctx.viewportRect).toEqual(viewportRect);
        expect(ctx.anchorDelta).toEqual(anchorDelta);
        seen.push("exit");
        return {} as Animation;
      },
      move(ctx) {
        expect(ctx.delta).toEqual({ x: -40, y: -40 });
        expect(ctx.anchorDelta).toEqual(anchorDelta);
        expect(ctx.scale).toEqual({ x: 1.5, y: 1.8 });
        seen.push("move");
        return {} as Animation;
      },
    };

    plugin.enter?.(buildEnterContext(element, currentRect, parent));
    plugin.exit?.(buildExitContext(element, currentRect, parent, { viewportRect, anchorDelta }));
    plugin.move?.(buildMoveContext(element, currentRect, previousRect, parent, { anchorDelta }));

    expect(seen).toEqual(["enter", "exit", "move"]);
  });
});

describe("defaultEnterTransition", () => {
  test("uses fade-only output by default", () => {
    const { animatedElement, calls } = createAnimatedElement();

    defaultEnterTransition(buildEnterContext(animatedElement, currentRect, parent));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.keyframes).toEqual([
      { offset: 0, opacity: 0 },
      { offset: 1, opacity: 1 },
    ]);
    expect(calls[0]?.options).toEqual({ duration: 250, easing: "ease-out" });
  });

  test("scales fade opacity from the element's computed opacity", () => {
    const { animatedElement, calls } = createAnimatedElement();

    withMockedComputedOpacity("0.5", () => {
      defaultEnterTransition(buildEnterContext(animatedElement, currentRect, parent));
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.keyframes).toEqual([
      { offset: 0, opacity: 0 },
      { offset: 1, opacity: 0.5 },
    ]);
  });
});

describe("defaultExitTransition", () => {
  test("uses fade-only output when no anchor compensation is needed", () => {
    const calls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
    const animatedElement = {
      animate(keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: KeyframeAnimationOptions) {
        calls.push({ keyframes: keyframes as Keyframe[], options: options ?? {} });
        return { finished: Promise.resolve() } as unknown as Animation;
      },
    } as unknown as Element;

    defaultExitTransition(buildExitContext(animatedElement, currentRect, parent));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.keyframes).toEqual([
      {
        offset: 0,
        position: "absolute",
        opacity: 1,
        width: "120px",
        height: "50px",
        margin: "0",
        top: "60px",
        left: "80px",
      },
      {
        offset: 1,
        position: "absolute",
        opacity: 0,
        width: "120px",
        height: "50px",
        margin: "0",
        top: "60px",
        left: "80px",
      },
    ]);
    expect(calls[0]?.options).toEqual({ duration: 250, easing: "ease-in" });
  });

  test("starts exit fade from the element's computed opacity", () => {
    const calls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
    const animatedElement = {
      animate(keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: KeyframeAnimationOptions) {
        calls.push({ keyframes: keyframes as Keyframe[], options: options ?? {} });
        return { finished: Promise.resolve() } as unknown as Animation;
      },
    } as unknown as Element;

    withMockedComputedOpacity("0.5", () => {
      defaultExitTransition(buildExitContext(animatedElement, currentRect, parent));
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.keyframes).toEqual([
      {
        offset: 0,
        position: "absolute",
        opacity: 0.5,
        width: "120px",
        height: "50px",
        margin: "0",
        top: "60px",
        left: "80px",
      },
      {
        offset: 1,
        position: "absolute",
        opacity: 0,
        width: "120px",
        height: "50px",
        margin: "0",
        top: "60px",
        left: "80px",
      },
    ]);
  });

  test("adds a fixed translate compensation when the parent shifts on exit", () => {
    const calls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
    const animatedElement = {
      animate(keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: KeyframeAnimationOptions) {
        calls.push({ keyframes: keyframes as Keyframe[], options: options ?? {} });
        return { finished: Promise.resolve() } as unknown as Animation;
      },
    } as unknown as Element;

    defaultExitTransition(
      buildExitContext(animatedElement, currentRect, parent, {
        viewportRect,
        anchorDelta,
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.keyframes[0]?.transform).toBe("translate(48px, 36px)");
    expect(calls[0]?.keyframes[1]?.transform).toBe("translate(48px, 36px)");
  });
});

describe("defaultMoveTransition", () => {
  test("keeps the previous transform output when no parent compensation is needed", () => {
    const calls: { keyframes: PropertyIndexedKeyframes | Keyframe[] | null; options: KeyframeAnimationOptions }[] = [];
    const animatedElement = {
      animate(keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: KeyframeAnimationOptions) {
        calls.push({ keyframes, options: options ?? {} });
        return { finished: Promise.resolve() } as unknown as Animation;
      },
    } as unknown as Element;

    defaultMoveTransition(buildMoveContext(animatedElement, currentRect, previousRect, parent));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.keyframes).toEqual([
      {
        offset: 0,
        transformOrigin: "0 0",
        transform: "translate(-40px, -40px) scale(1.5, 1.8)",
      },
      {
        offset: 1,
        transformOrigin: "0 0",
        transform: "translate(0, 0) scale(1, 1)",
      },
    ]);
    expect(calls[0]?.options).toEqual({ duration: 250, easing: "ease-in" });
  });

  test("adds parent anchor compensation to the move delta", () => {
    const calls: { keyframes: PropertyIndexedKeyframes | Keyframe[] | null; options: KeyframeAnimationOptions }[] = [];
    const animatedElement = {
      animate(keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: KeyframeAnimationOptions) {
        calls.push({ keyframes, options: options ?? {} });
        return { finished: Promise.resolve() } as unknown as Animation;
      },
    } as unknown as Element;

    defaultMoveTransition(buildMoveContext(animatedElement, currentRect, previousRect, parent, { anchorDelta }));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.keyframes).toEqual([
      {
        offset: 0,
        transformOrigin: "0 0",
        transform: "translate(8px, -4px) scale(1.5, 1.8)",
      },
      {
        offset: 1,
        transformOrigin: "0 0",
        transform: "translate(0, 0) scale(1, 1)",
      },
    ]);
  });
});

describe("defineTransition", () => {
  test("supports mixing composable phases with imperative functions in one transition", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const exit = (ctx: Parameters<NonNullable<CompiledTransitionPlugin["exit"]>>[0]) => {
      expect(ctx.rect).toEqual(currentRect);
      expect(ctx.viewportRect).toEqual(viewportRect);
      expect(ctx.anchorDelta).toEqual(anchorDelta);
      return { finished: Promise.resolve() } as unknown as Animation;
    };

    const transition: TransitionPlugin = {
      enter: transitionPresets.enter.fade({
        duration: 180,
      }),
      exit,
      move: transitionPresets.move.translate({
        duration: 200,
      }),
    };

    const compiled = defineTransition(transition);

    expect(compiled.exit).toBe(exit);

    compiled.enter?.(buildEnterContext(animatedElement, currentRect, parent));
    compiled.exit?.(
      buildExitContext(animatedElement, currentRect, parent, {
        viewportRect,
        anchorDelta,
      }),
    );
    compiled.move?.(buildMoveContext(animatedElement, currentRect, previousRect, parent, { anchorDelta }));

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      keyframes: [
        { offset: 0, opacity: 0 },
        { offset: 1, opacity: 1 },
      ],
      options: { duration: 180, easing: "ease-out" },
    });
    expect(calls[1]).toEqual({
      keyframes: [
        { offset: 0, transform: "translate(8px, -4px)" },
        { offset: 1, transform: "translate(0, 0)" },
      ],
      options: { duration: 200, easing: "ease-out" },
    });
  });

  test("compiles declarative effect phases into transition plugins", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition({
      enter: transitionPhases.enter(
        transitionEffects.common.fade(),
        transitionEffects.common.scale({
          from: 0.96,
          to: 1,
          transformOrigin: "50% 50%",
        }),
        transitionEffects.enter.slide({
          from: { x: 0, y: 12 },
          to: { x: 0, y: 0 },
        }),
        { duration: 180, easing: "linear" },
      ),
    });

    transition.enter?.(buildEnterContext(animatedElement, currentRect, parent));

    expect(calls).toEqual([
      {
        keyframes: [
          {
            offset: 0,
            opacity: 0,
            transformOrigin: "50% 50%",
            transform: "translate(0px, 12px) scale(0.96, 0.96)",
          },
          {
            offset: 1,
            opacity: 1,
            transformOrigin: "50% 50%",
            transform: "translate(0, 0) scale(1, 1)",
          },
        ],
        options: { duration: 180, easing: "linear" },
      },
    ]);
  });

  test("absolute exit preset automatically includes anchor compensation", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition({
      exit: transitionPresets.exit.absoluteFadeScale(),
    });

    transition.exit?.(
      buildExitContext(animatedElement, currentRect, parent, {
        viewportRect,
        anchorDelta,
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.keyframes).toEqual([
      {
        offset: 0,
        position: "absolute",
        opacity: 1,
        transformOrigin: "50% 50%",
        transform: "translate(48px, 36px) scale(1, 1)",
        width: "120px",
        height: "50px",
        margin: "0",
        top: "60px",
        left: "80px",
      },
      {
        offset: 1,
        position: "absolute",
        opacity: 0,
        transformOrigin: "50% 50%",
        transform: "translate(48px, 36px) scale(0.96, 0.96)",
        width: "120px",
        height: "50px",
        margin: "0",
        top: "60px",
        left: "80px",
      },
    ]);
  });

  test("flip preset can omit scale while keeping compensated motion", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition({
      move: transitionPresets.move.flip({ includeScale: false }),
    });

    transition.move?.(buildMoveContext(animatedElement, currentRect, previousRect, parent, { anchorDelta }));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.keyframes).toEqual([
      { offset: 0, transform: "translate(8px, -4px)" },
      { offset: 1, transform: "translate(0, 0)" },
    ]);
    expect(calls[0]?.options).toEqual({ duration: 250, easing: "ease-in" });
  });

  test("pop preset adds an overshoot keyframe for enter", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition({
      enter: transitionPresets.enter.pop({
        fromTranslate: { x: 0, y: 6 },
      }),
    });

    transition.enter?.(buildEnterContext(animatedElement, currentRect, parent));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.keyframes).toEqual([
      {
        offset: 0,
        opacity: 0,
        transformOrigin: "50% 50%",
        transform: "translate(0px, 6px) scale(0.9, 0.9)",
      },
      {
        offset: 0.7,
        opacity: 1,
        transformOrigin: "50% 50%",
        transform: "translate(0px, 6px) scale(1.03, 1.03)",
      },
      {
        offset: 1,
        opacity: 1,
        transformOrigin: "50% 50%",
        transform: "translate(0, 0) scale(1, 1)",
      },
    ]);
    expect(calls[0]?.options).toEqual({
      duration: 280,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    });
  });

  test("absolute slide fade preset combines anchor compensation with travel distance", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition({
      exit: transitionPresets.exit.absoluteSlideFade({
        distance: 10,
      }),
    });

    transition.exit?.(
      buildExitContext(animatedElement, currentRect, parent, {
        viewportRect,
        anchorDelta,
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.keyframes).toEqual([
      {
        offset: 0,
        position: "absolute",
        opacity: 1,
        transform: "translate(48px, 36px)",
        width: "120px",
        height: "50px",
        margin: "0",
        top: "60px",
        left: "80px",
      },
      {
        offset: 1,
        position: "absolute",
        opacity: 0,
        transform: "translate(48px, 26px)",
        width: "120px",
        height: "50px",
        margin: "0",
        top: "60px",
        left: "80px",
      },
    ]);
    expect(calls[0]?.options).toEqual({ duration: 220, easing: "ease-in" });
  });

  test("translate preset provides motion-only FLIP defaults", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition({
      move: transitionPresets.move.translate(),
    });

    transition.move?.(buildMoveContext(animatedElement, currentRect, previousRect, parent, { anchorDelta }));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.keyframes).toEqual([
      { offset: 0, transform: "translate(8px, -4px)" },
      { offset: 1, transform: "translate(0, 0)" },
    ]);
    expect(calls[0]?.options).toEqual({ duration: 220, easing: "ease-out" });
  });
});

describe("transitionEffects composition", () => {
  test("merges fade, scale, and blur into one animation", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition({
      enter: transitionPhases.enter(
        transitionEffects.common.fade({ from: 0, to: 1 }),
        transitionEffects.common.scale({ from: 0.96, to: 1 }),
        transitionEffects.common.blur({ from: "8px", to: "0px" }),
        { duration: 250, easing: "ease-out" },
      ),
    });

    transition.enter?.(buildEnterContext(animatedElement, currentRect, parent));

    expect(calls).toEqual([
      {
        keyframes: [
          {
            offset: 0,
            opacity: 0,
            transformOrigin: "50% 50%",
            transform: "scale(0.96, 0.96)",
            filter: "blur(8px)",
          },
          {
            offset: 1,
            opacity: 1,
            transformOrigin: "50% 50%",
            transform: "scale(1, 1)",
            filter: "blur(0px)",
          },
        ],
        options: { duration: 250, easing: "ease-out" },
      },
    ]);
  });

  test("composes slide with scale into a single transform timeline", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition({
      enter: transitionPhases.enter(
        transitionEffects.enter.slide({ axis: "x", distance: 24 }),
        transitionEffects.common.scale({ from: 0.92, to: 1 }),
        { duration: 210, easing: "ease-out" },
      ),
    });

    transition.enter?.(buildEnterContext(animatedElement, currentRect, parent));

    expect(calls[0]?.keyframes).toEqual([
      {
        offset: 0,
        transformOrigin: "50% 50%",
        transform: "translate(24px, 0px) scale(0.92, 0.92)",
      },
      {
        offset: 1,
        transformOrigin: "50% 50%",
        transform: "translate(0, 0) scale(1, 1)",
      },
    ]);
  });

  test("composes FLIP translate and scale as independent effects", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition({
      move: transitionPhases.move(
        transitionEffects.move.flipTranslate({ includeAnchorDelta: true }),
        transitionEffects.move.flipScale(),
        { duration: 260, easing: "linear" },
      ),
    });

    transition.move?.(buildMoveContext(animatedElement, currentRect, previousRect, parent, { anchorDelta }));

    expect(calls[0]?.keyframes).toEqual([
      {
        offset: 0,
        transformOrigin: "0 0",
        transform: "translate(8px, -4px) scale(1.5, 1.8)",
      },
      {
        offset: 1,
        transformOrigin: "0 0",
        transform: "translate(0, 0) scale(1, 1)",
      },
    ]);
  });

  test("keeps absolute exit layout base while adding blur", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition({
      exit: transitionPhases.exit.absolute(
        transitionEffects.common.fade({ from: 1, to: 0 }),
        transitionEffects.exit.anchorTranslate({ includeAnchorDelta: true }),
        transitionEffects.common.blur({ from: "0px", to: "6px" }),
        { duration: 230, easing: "ease-in" },
      ),
    });

    transition.exit?.(
      buildExitContext(animatedElement, currentRect, parent, {
        viewportRect,
        anchorDelta,
      }),
    );

    expect(calls[0]?.keyframes).toEqual([
      {
        offset: 0,
        position: "absolute",
        opacity: 1,
        transform: "translate(48px, 36px)",
        filter: "blur(0px)",
        width: "120px",
        height: "50px",
        margin: "0",
        top: "60px",
        left: "80px",
      },
      {
        offset: 1,
        position: "absolute",
        opacity: 0,
        transform: "translate(48px, 36px)",
        filter: "blur(6px)",
        width: "120px",
        height: "50px",
        margin: "0",
        top: "60px",
        left: "80px",
      },
    ]);
  });

  test("fills missing frame values from the nearest surrounding keyframe", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition({
      enter: transitionPhases.enter(
        transitionEffects.common.fade({
          keyframes: [
            { offset: 0.3, value: 0.2 },
            { offset: 0.7, value: 1 },
          ],
        }),
        transitionEffects.common.blur({
          keyframes: [
            { offset: 0, value: "10px" },
            { offset: 0.5, value: "4px" },
          ],
        }),
        { duration: 200, easing: "linear" },
      ),
    });

    transition.enter?.(buildEnterContext(animatedElement, currentRect, parent));

    expect(calls[0]?.keyframes).toEqual([
      { offset: 0, opacity: 0.2, filter: "blur(10px)" },
      { offset: 0.3, opacity: 0.2, filter: "blur(10px)" },
      { offset: 0.5, opacity: 0.2, filter: "blur(4px)" },
      { offset: 0.7, opacity: 1, filter: "blur(4px)" },
      { offset: 1, opacity: 1, filter: "blur(4px)" },
    ]);
  });

  test("throws when two effects both control opacity", () => {
    const compiled = defineTransition({
      enter: transitionPhases.enter(transitionEffects.common.fade(), transitionEffects.common.fade()),
    });

    expect(() => compiled.enter?.(buildEnterContext(element, currentRect, parent))).toThrow(
      'Transition effects conflict on "opacity"',
    );
  });

  test("throws when two effects both control transform.scale", () => {
    const compiled = defineTransition({
      enter: transitionPhases.enter(
        transitionEffects.common.scale(),
        transitionEffects.common.scale({ from: 0.9, to: 1 }),
      ),
    });

    expect(() => compiled.enter?.(buildEnterContext(element, currentRect, parent))).toThrow(
      'Transition effects conflict on "transformOrigin"',
    );
  });

  test("throws when two effects both control filter.blur", () => {
    const compiled = defineTransition({
      enter: transitionPhases.enter(transitionEffects.common.blur(), transitionEffects.common.blur({ from: "4px" })),
    });

    expect(() => compiled.enter?.(buildEnterContext(element, currentRect, parent))).toThrow(
      'Transition effects conflict on "filter.blur"',
    );
  });

  test("uses shared phase timing for all composed effects", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition({
      enter: transitionPhases.enter(
        transitionEffects.common.fade(),
        transitionEffects.common.scale(),
        transitionEffects.common.blur(),
        { duration: 333, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      ),
    });

    transition.enter?.(buildEnterContext(animatedElement, currentRect, parent));

    expect(calls[0]?.options).toEqual({
      duration: 333,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    });
  });
});

describe("geometry helpers", () => {
  test("returns previous/current for normal sizes", () => {
    expect(getScaleFactor(180, 120)).toBe(1.5);
  });

  test("guards zero-sized current dimensions", () => {
    expect(getScaleFactor(180, 0)).toBe(1);
  });

  test("computes standard FLIP move geometry", () => {
    expect(getMoveGeometry(currentRect, previousRect)).toEqual({
      delta: { x: -40, y: -40 },
      scale: { x: 1.5, y: 1.8 },
    });
  });
});

describe("planBatchAnimations", () => {
  const batchParent = { left: 0, top: 0, width: 300, height: 200 };

  function createSnapshot<T>(parentRect: BatchSnapshot<T>["parent"], entries: Array<[T, Rect]>): BatchSnapshot<T> {
    return {
      parent: parentRect,
      rects: new Map(entries),
    };
  }

  function createExit<T>(node: T, rect: Rect): PendingExitRecord<T> {
    return {
      node,
      rect,
      viewportRect: rect,
    };
  }

  test("uses the final batch anchor delta for replacement exits", () => {
    const oldNode = { id: "old" };
    const newNode = { id: "new" };
    const before = createSnapshot({ ...batchParent, left: 120, top: 80 }, [[oldNode, currentRect]]);
    const after = createSnapshot({ ...batchParent, left: 72, top: 44 }, [[newNode, currentRect]]);
    const plan = planBatchAnimations({
      before,
      after,
      finalNodes: [newNode],
      pendingEnters: new Set([newNode]),
      pendingExits: new Map([[oldNode, createExit(oldNode, currentRect)]]),
    });

    expect(plan.enters.map((entry) => entry.node)).toEqual([newNode]);
    expect(plan.exits).toEqual([
      {
        node: oldNode,
        rect: currentRect,
        viewportRect: currentRect,
        anchorDelta: { x: 48, y: 36 },
      },
    ]);
  });

  test("applies the same net anchor compensation to moves after batch layout shifts", () => {
    const persistedNode = { id: "persisted" };
    const before = createSnapshot({ ...batchParent, left: 200, top: 160 }, [[persistedNode, previousRect]]);
    const after = createSnapshot({ ...batchParent, left: 152, top: 124 }, [[persistedNode, currentRect]]);
    const plan = planBatchAnimations({
      before,
      after,
      finalNodes: [persistedNode],
      pendingEnters: new Set<typeof persistedNode>(),
      pendingExits: new Map(),
    });

    expect(plan.moves).toEqual([
      {
        node: persistedNode,
        previous: previousRect,
        current: currentRect,
        anchorDelta: { x: 48, y: 36 },
      },
    ]);
  });

  test("keeps reordered existing nodes on the move path instead of enter", () => {
    const existingNode = { id: "existing" };
    const before = createSnapshot(batchParent, [[existingNode, previousRect]]);
    const after = createSnapshot(batchParent, [[existingNode, currentRect]]);
    const plan = planBatchAnimations({
      before,
      after,
      finalNodes: [existingNode],
      pendingEnters: new Set(),
      pendingExits: new Map(),
    });

    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0]?.node).toBe(existingNode);
    expect(plan.enters).toEqual([]);
  });

  test("treats same-batch remove and reinsert of the same node as a move", () => {
    const reinsertedNode = { id: "same-node" };
    const before = createSnapshot(batchParent, [[reinsertedNode, previousRect]]);
    const after = createSnapshot(batchParent, [[reinsertedNode, currentRect]]);
    const plan = planBatchAnimations({
      before,
      after,
      finalNodes: [reinsertedNode],
      pendingEnters: new Set(),
      pendingExits: new Map(),
    });

    expect(plan.moves.map((entry) => entry.node)).toEqual([reinsertedNode]);
    expect(plan.exits).toEqual([]);
    expect(plan.enters).toEqual([]);
  });

  test("drops transient same-batch inserts that are removed before flush", () => {
    const before = createSnapshot(batchParent, []);
    const after = createSnapshot(batchParent, []);
    const plan = planBatchAnimations({
      before,
      after,
      finalNodes: [],
      pendingEnters: new Set(),
      pendingExits: new Map(),
    });

    expect(plan.moves).toEqual([]);
    expect(plan.enters).toEqual([]);
    expect(plan.exits).toEqual([]);
  });
});
