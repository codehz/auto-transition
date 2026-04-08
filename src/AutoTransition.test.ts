import { describe, expect, test } from "bun:test";
import {
  buildEnterContext,
  buildExitContext,
  buildMoveContext,
  defaultExitTransition,
  defaultMoveTransition,
  getMoveGeometry,
  getScaleFactor,
  type ParentBounds,
  type Point,
  type Rect,
  type TransitionPlugin,
} from "./AutoTransition.tsx";

const element = { id: "demo" } as unknown as Element;
const parent: ParentBounds = { width: 300, height: 200 };
const currentRect: Rect = { x: 80, y: 60, width: 120, height: 50 };
const previousRect: Rect = { x: 40, y: 20, width: 180, height: 90 };
const viewportRect: Rect = { x: 180, y: 160, width: 120, height: 50 };
const anchorDelta: Point = { x: 48, y: 36 };

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
    const plugin: TransitionPlugin = {
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

describe("defaultExitTransition", () => {
  test("keeps the previous transform output when no anchor compensation is needed", () => {
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
        position: "absolute",
        opacity: 1,
        transformOrigin: "50% 50%",
        transform: "scale(1, 1)",
        width: "120px",
        height: "50px",
        margin: "0",
        top: "60px",
        left: "80px",
      },
      {
        position: "absolute",
        opacity: 0,
        transformOrigin: "50% 50%",
        transform: "scale(0.96, 0.96)",
        width: "120px",
        height: "50px",
        margin: "0",
        top: "60px",
        left: "80px",
      },
    ]);
    expect(calls[0]?.options).toEqual({ duration: 250, easing: "ease-in" });
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
    expect(calls[0]?.keyframes[0]?.transform).toBe("translate(48px, 36px) scale(1, 1)");
    expect(calls[0]?.keyframes[1]?.transform).toBe("translate(48px, 36px) scale(0.96, 0.96)");
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
    expect(calls[0]?.keyframes).toEqual({
      transformOrigin: ["0 0", "0 0"],
      transform: ["translate(-40px, -40px) scale(1.5, 1.8)", "translate(0, 0) scale(1, 1)"],
    });
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
    expect(calls[0]?.keyframes).toEqual({
      transformOrigin: ["0 0", "0 0"],
      transform: ["translate(8px, -4px) scale(1.5, 1.8)", "translate(0, 0) scale(1, 1)"],
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
