import { describe, expect, test } from "bun:test";
import {
  buildEnterContext,
  buildExitContext,
  buildMoveContext,
  defaultExitTransition,
  getMoveGeometry,
  getScaleFactor,
  type ExitAnchor,
  type Insets,
  type Rect,
  type ParentBounds,
  type TransitionPlugin,
} from "./AutoTransition.tsx";

const element = { id: "demo" } as unknown as Element;
const parent: ParentBounds = { width: 300, height: 200 };
const currentRect: Rect = { x: 80, y: 60, width: 120, height: 50 };
const previousRect: Rect = { x: 40, y: 20, width: 180, height: 90 };

describe("buildExitContext", () => {
  test("defaults to left/top anchor with derived insets", () => {
    const context = buildExitContext(element, currentRect, parent);

    expect(context.element).toBe(element);
    expect(context.parent).toEqual(parent);
    expect(context.rect).toEqual(currentRect);
    expect(context.anchor).toEqual({ horizontal: "left", vertical: "top" });
    expect(context.insets).toEqual({ top: 60, right: 100, bottom: 90, left: 80 });
  });

  test("keeps custom anchor and insets when provided", () => {
    const anchor: ExitAnchor = { horizontal: "right", vertical: "bottom" };
    const insets: Insets = { top: 60, right: 100, bottom: 90, left: 80 };
    const context = buildExitContext(element, currentRect, parent, { anchor, insets });

    expect(context.anchor).toEqual(anchor);
    expect(context.insets).toEqual(insets);
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
    expect(context.scale).toEqual({ x: 1.5, y: 1.8 });
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
        expect(ctx.anchor).toEqual({ horizontal: "left", vertical: "top" });
        expect(ctx.insets).toEqual({ top: 60, right: 100, bottom: 90, left: 80 });
        seen.push("exit");
        return {} as Animation;
      },
      move(ctx) {
        expect(ctx.delta).toEqual({ x: -40, y: -40 });
        expect(ctx.scale).toEqual({ x: 1.5, y: 1.8 });
        seen.push("move");
        return {} as Animation;
      },
    };

    plugin.enter?.(buildEnterContext(element, currentRect, parent));
    plugin.exit?.(buildExitContext(element, currentRect, parent));
    plugin.move?.(buildMoveContext(element, currentRect, previousRect, parent));

    expect(seen).toEqual(["enter", "exit", "move"]);
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

describe("defaultExitTransition", () => {
  function createAnimatedElement() {
    const calls: [Keyframe[], KeyframeAnimationOptions | number | undefined][] = [];
    const animatedElement = {
      animate(keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: KeyframeAnimationOptions | number) {
        calls.push([keyframes as Keyframe[], options]);
        return {} as Animation;
      },
    } as unknown as Element;
    return { animatedElement, calls };
  }

  test("freezes left/top anchored elements with opposite sides reset to auto", () => {
    const { animatedElement, calls } = createAnimatedElement();

    defaultExitTransition(buildExitContext(animatedElement, currentRect, parent));

    const [keyframes, options] = calls[0]!;
    expect(options).toEqual({ duration: 250, easing: "ease-in" });
    expect(keyframes[0]).toEqual({
      position: "absolute",
      opacity: 1,
      transformOrigin: "50% 50%",
      transform: "scale(1, 1)",
      width: "120px",
      height: "50px",
      margin: "0",
      top: "60px",
      right: "auto",
      bottom: "auto",
      left: "80px",
    });
    expect(keyframes[1]).toEqual({
      ...keyframes[0],
      opacity: 0,
      transform: "scale(0.96, 0.96)",
    });
  });

  test("freezes right/bottom anchored elements without switching to left/top", () => {
    const { animatedElement, calls } = createAnimatedElement();

    defaultExitTransition(
      buildExitContext(animatedElement, currentRect, parent, {
        anchor: { horizontal: "right", vertical: "bottom" },
        insets: { top: 60, right: 100, bottom: 90, left: 80 },
      }),
    );

    const [keyframes] = calls[0]!;
    expect(keyframes[0]).toEqual({
      position: "absolute",
      opacity: 1,
      transformOrigin: "50% 50%",
      transform: "scale(1, 1)",
      width: "120px",
      height: "50px",
      margin: "0",
      top: "auto",
      right: "100px",
      bottom: "90px",
      left: "auto",
    });
    expect(keyframes[1]).toEqual({
      ...keyframes[0],
      opacity: 0,
      transform: "scale(0.96, 0.96)",
    });
  });
});
