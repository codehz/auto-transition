import { describe, expect, test } from "bun:test";
import {
  buildEnterContext,
  buildExitContext,
  buildMoveContext,
  defaultEnterTransition,
  defaultExitTransition,
  defaultMoveTransition,
  defineTransition,
  effects,
  getMoveGeometry,
  getScaleFactor,
  preset,
  type CompiledTransitionPlugin,
  type EnterEffect,
  type ParentBounds,
  type Point,
  type Rect,
  type TransitionPlugin,
} from "./AutoTransition.tsx";
import { blur, effects as effectsModule, fade, flip, scale, translate, type MoveEffect } from "./effects.ts";
import { planBatchAnimations, type BatchSnapshot, type PendingExitRecord } from "./batchPlan.ts";
import { prepareNodeForExit, restorePreparedExitNode } from "./exitLayout.ts";

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

type StyledTestElement = {
  style: {
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
};

describe("buildExitContext", () => {
  test("keeps element geometry relative to the measured parent", () => {
    const context = buildExitContext(element, currentRect, parent);

    expect(context.element).toBe(element);
    expect(context.parent).toEqual(parent);
    expect(context.rect).toEqual(currentRect);
    expect(context.viewportRect).toEqual(currentRect);
    expect(context.anchorDelta).toEqual({ x: 0, y: 0 });
    expect(context.layoutMode).toBe("absolute");
  });

  test("keeps viewport geometry, anchor compensation, and layout mode when provided", () => {
    const context = buildExitContext(element, currentRect, parent, {
      viewportRect,
      anchorDelta,
      layoutMode: "flow",
    });

    expect(context.viewportRect).toEqual(viewportRect);
    expect(context.anchorDelta).toEqual(anchorDelta);
    expect(context.layoutMode).toBe("flow");
  });
});

describe("prepareNodeForExit", () => {
  test("locks and restores inline layout styles for absolute exits", () => {
    const styledElement: StyledTestElement = {
      style: {
        position: "relative",
        top: "1px",
        left: "2px",
        right: "3px",
        bottom: "4px",
        width: "50px",
        height: "60px",
        margin: "7px",
        pointerEvents: "auto",
      },
    };

    const prepared = prepareNodeForExit(styledElement as unknown as Element, currentRect, "absolute");

    expect(styledElement.style).toMatchObject({
      position: "absolute",
      top: "60px",
      left: "80px",
      right: "auto",
      bottom: "auto",
      width: "120px",
      height: "50px",
      margin: "0",
      pointerEvents: "none",
    });

    restorePreparedExitNode(styledElement as unknown as Element, prepared);

    expect(styledElement.style).toMatchObject({
      position: "relative",
      top: "1px",
      left: "2px",
      right: "3px",
      bottom: "4px",
      width: "50px",
      height: "60px",
      margin: "7px",
      pointerEvents: "auto",
    });
  });

  test("keeps inline layout styles untouched for flow exits and same-batch reinserts", () => {
    const style = {
      position: "relative",
      top: "1px",
      left: "2px",
      right: "3px",
      bottom: "4px",
      width: "50px",
      height: "60px",
      margin: "7px",
      pointerEvents: "auto",
    };
    const styledElement: StyledTestElement = { style: { ...style } };

    const prepared = prepareNodeForExit(styledElement as unknown as Element, currentRect, "flow");

    expect(styledElement.style).toMatchObject(style);

    restorePreparedExitNode(styledElement as unknown as Element, prepared);

    expect(styledElement.style).toMatchObject(style);
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

describe("effects module", () => {
  test("exports both named effects and the aggregate object", () => {
    expect(effects.fade).toBe(fade);
    expect(effects.scale).toBe(scale);
    expect(effects.blur).toBe(blur);
    expect(effects.translate).toBe(translate);
    expect(effects.flip).toBe(flip);

    expect(effectsModule.fade).toBe(fade);
    expect(effectsModule.scale).toBe(scale);
    expect(effectsModule.blur).toBe(blur);
    expect(effectsModule.translate).toBe(translate);
    expect(effectsModule.flip).toBe(flip);
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
  test("uses the same fade authoring and injects absolute layout only when needed", () => {
    const { animatedElement, calls } = createAnimatedElement();

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

  test("omits the absolute layout base for flow exit layout", () => {
    const { animatedElement, calls } = createAnimatedElement();

    defaultExitTransition(buildExitContext(animatedElement, currentRect, parent, { layoutMode: "flow" }));

    expect(calls[0]?.keyframes).toEqual([
      { offset: 0, opacity: 1 },
      { offset: 1, opacity: 0 },
    ]);
  });

  test("starts exit fade from the element's computed opacity", () => {
    const { animatedElement, calls } = createAnimatedElement();

    withMockedComputedOpacity("0.5", () => {
      defaultExitTransition(buildExitContext(animatedElement, currentRect, parent));
    });

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
});

describe("defaultMoveTransition", () => {
  test("keeps translate plus scale FLIP output by default", () => {
    const { animatedElement, calls } = createAnimatedElement();

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
    const { animatedElement, calls } = createAnimatedElement();

    defaultMoveTransition(buildMoveContext(animatedElement, currentRect, previousRect, parent, { anchorDelta }));

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
  test("keeps imperative handlers unchanged", () => {
    const seen: string[] = [];
    const transition: TransitionPlugin = {
      enter() {
        seen.push("enter");
        return {} as Animation;
      },
      exit() {
        seen.push("exit");
        return {} as Animation;
      },
      move() {
        seen.push("move");
        return {} as Animation;
      },
    };

    const compiled = defineTransition(transition);

    compiled.enter?.(buildEnterContext(element, currentRect, parent));
    compiled.exit?.(buildExitContext(element, currentRect, parent));
    compiled.move?.(buildMoveContext(element, currentRect, previousRect, parent));

    expect(seen).toEqual(["enter", "exit", "move"]);
  });
});

describe("preset", () => {
  test("builds declarative enter effects with single-layer phase config", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition(
      preset({
        enter: [effects.fade(0), effects.scale(0.96), effects.translate({ x: 0, y: 12 })],
        timing: {
          enter: { duration: 220, easing: "ease-out" },
        },
      }),
    );

    transition.enter?.(buildEnterContext(animatedElement, currentRect, parent));

    expect(calls[0]).toEqual({
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
      options: { duration: 220, easing: "ease-out" },
    });
  });

  test("uses the same exit authoring for absolute and flow layout", () => {
    const transition = defineTransition(
      preset({
        exit: effects.fade(0),
        timing: {
          exit: { duration: 180, easing: "ease-in" },
        },
      }),
    );

    const absolute = createAnimatedElement();
    transition.exit?.(buildExitContext(absolute.animatedElement, currentRect, parent));
    expect(absolute.calls[0]).toEqual({
      keyframes: [
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
      ],
      options: { duration: 180, easing: "ease-in" },
    });

    const flow = createAnimatedElement();
    transition.exit?.(buildExitContext(flow.animatedElement, currentRect, parent, { layoutMode: "flow" }));
    expect(flow.calls[0]).toEqual({
      keyframes: [
        { offset: 0, opacity: 1 },
        { offset: 1, opacity: 0 },
      ],
      options: { duration: 180, easing: "ease-in" },
    });
  });

  test("adds anchor compensation to exit translate automatically", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition(
      preset({
        exit: [effects.fade(0), effects.translate({ x: 0, y: -10 })],
      }),
    );

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
  });

  test("supports percentage-based translate values", () => {
    const enterTransition = defineTransition(
      preset({
        enter: effects.translate({ x: "50%", y: "-25%" }),
      }),
    );
    const enter = createAnimatedElement();
    enterTransition.enter?.(buildEnterContext(enter.animatedElement, currentRect, parent));
    expect(enter.calls[0]?.keyframes).toEqual([
      { offset: 0, transform: "translate(60px, -12.5px)" },
      { offset: 1, transform: "translate(0, 0)" },
    ]);

    const exitTransition = defineTransition(
      preset({
        exit: [effects.fade(0), effects.translate({ x: "50%", y: "-20%" })],
      }),
    );
    const exit = createAnimatedElement();
    exitTransition.exit?.(
      buildExitContext(exit.animatedElement, currentRect, parent, {
        viewportRect,
        anchorDelta,
      }),
    );
    expect(exit.calls[0]?.keyframes).toEqual([
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
        transform: "translate(108px, 26px)",
        width: "120px",
        height: "50px",
        margin: "0",
        top: "60px",
        left: "80px",
      },
    ]);
  });

  test("supports numeric and string blur values", () => {
    const enterTransition = defineTransition(
      preset({
        enter: blur(8),
      }),
    );
    const enter = createAnimatedElement();
    enterTransition.enter?.(buildEnterContext(enter.animatedElement, currentRect, parent));
    expect(enter.calls[0]?.keyframes).toEqual([
      { offset: 0, filter: "blur(8px)" },
      { offset: 1, filter: "blur(0px)" },
    ]);

    const exitTransition = defineTransition(
      preset({
        exit: blur("0.5rem"),
      }),
    );
    const exit = createAnimatedElement();
    exitTransition.exit?.(buildExitContext(exit.animatedElement, currentRect, parent, { layoutMode: "flow" }));
    expect(exit.calls[0]?.keyframes).toEqual([
      { offset: 0, filter: "blur(0px)" },
      { offset: 1, filter: "blur(0.5rem)" },
    ]);
  });

  test("supports numeric and object scale values", () => {
    const enterTransition = defineTransition(
      preset({
        enter: scale(0.96),
      }),
    );
    const enter = createAnimatedElement();
    enterTransition.enter?.(buildEnterContext(enter.animatedElement, currentRect, parent));
    expect(enter.calls[0]?.keyframes).toEqual([
      {
        offset: 0,
        transformOrigin: "50% 50%",
        transform: "scale(0.96, 0.96)",
      },
      {
        offset: 1,
        transformOrigin: "50% 50%",
        transform: "scale(1, 1)",
      },
    ]);

    const exitTransition = defineTransition(
      preset({
        exit: scale({ x: 1.1, y: 0.9 }),
      }),
    );
    const exit = createAnimatedElement();
    exitTransition.exit?.(buildExitContext(exit.animatedElement, currentRect, parent, { layoutMode: "flow" }));
    expect(exit.calls[0]?.keyframes).toEqual([
      {
        offset: 0,
        transformOrigin: "50% 50%",
        transform: "scale(1, 1)",
      },
      {
        offset: 1,
        transformOrigin: "50% 50%",
        transform: "scale(1.1, 0.9)",
      },
    ]);
  });

  test("flip can omit scale while keeping compensated motion", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition(
      preset({
        move: effects.flip({ scale: false }),
        timing: {
          move: { duration: 200, easing: "ease-out" },
        },
      }),
    );

    transition.move?.(buildMoveContext(animatedElement, currentRect, previousRect, parent, { anchorDelta }));

    expect(calls[0]).toEqual({
      keyframes: [
        { offset: 0, transformOrigin: "0 0", transform: "translate(8px, -4px)" },
        { offset: 1, transformOrigin: "0 0", transform: "translate(0, 0)" },
      ],
      options: { duration: 200, easing: "ease-out" },
    });
  });

  test("applies independent timing per phase", () => {
    const transition = defineTransition(
      preset({
        enter: effects.fade(0),
        exit: effects.fade(0),
        move: effects.flip(),
        timing: {
          enter: { duration: 111, easing: "ease-out" },
          exit: { duration: 222, easing: "ease-in" },
          move: { duration: 333, easing: "linear" },
        },
      }),
    );

    const enter = createAnimatedElement();
    transition.enter?.(buildEnterContext(enter.animatedElement, currentRect, parent));
    expect(enter.calls[0]?.options).toEqual({ duration: 111, easing: "ease-out" });

    const exit = createAnimatedElement();
    transition.exit?.(buildExitContext(exit.animatedElement, currentRect, parent, { layoutMode: "flow" }));
    expect(exit.calls[0]?.options).toEqual({ duration: 222, easing: "ease-in" });

    const move = createAnimatedElement();
    transition.move?.(buildMoveContext(move.animatedElement, currentRect, previousRect, parent));
    expect(move.calls[0]?.options).toEqual({ duration: 333, easing: "linear" });
  });

  test("supports keyframes for declarative effects", () => {
    const { animatedElement, calls } = createAnimatedElement();
    const transition = defineTransition(
      preset({
        enter: [
          effects.fade({
            keyframes: [
              { offset: 0.3, value: 0.2 },
              { offset: 0.7, value: 1 },
            ],
          }),
          effects.blur({
            keyframes: [
              { offset: 0, value: 10 },
              { offset: 0.5, value: 4 },
            ],
          }),
        ],
        timing: {
          enter: { duration: 200, easing: "linear" },
        },
      }),
    );

    transition.enter?.(buildEnterContext(animatedElement, currentRect, parent));

    expect(calls[0]?.keyframes).toEqual([
      { offset: 0, opacity: 0.2, filter: "blur(10px)" },
      { offset: 0.3, opacity: 0.2, filter: "blur(10px)" },
      { offset: 0.5, opacity: 0.2, filter: "blur(4px)" },
      { offset: 0.7, opacity: 1, filter: "blur(4px)" },
      { offset: 1, opacity: 1, filter: "blur(4px)" },
    ]);
    expect(calls[0]?.options).toEqual({ duration: 200, easing: "linear" });
  });

  test("throws a clearer conflict error for duplicate translate effects", () => {
    const transition = defineTransition(
      preset({
        enter: [effects.translate({ x: 0, y: 8 }), effects.translate({ x: 0, y: 4 })],
      }),
    );

    expect(() => transition.enter?.(buildEnterContext(element, currentRect, parent))).toThrow(
      "translate() conflicts with another translate() effect",
    );
  });

  test("throws a clearer phase error when move-only effects are forced into enter", () => {
    expect(() =>
      preset({
        enter: [flip() as unknown as EnterEffect],
      }),
    ).toThrow("flip() can only be used in move");
  });

  test("supports move-only preset values typed as single effect", () => {
    const moveOnly: MoveEffect = effects.flip();
    const transition = preset({
      move: moveOnly,
    });

    expect(transition.move).toBeDefined();
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
