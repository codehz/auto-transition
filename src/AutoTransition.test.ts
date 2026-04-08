import { describe, expect, test } from "bun:test";
import {
  buildEnterContext,
  buildExitContext,
  buildMoveContext,
  defaultExitTransition,
  type Rect,
  type TransitionPlugin,
} from "./AutoTransition.tsx";
import type { Anchor, ParentBounds } from "./anchor.ts";

const element = { id: "demo" } as unknown as Element;
const currentParent: ParentBounds = { x: 200, y: 120, width: 300, height: 200 };
const previousParent: ParentBounds = { x: 160, y: 80, width: 340, height: 240 };
const currentRect: Rect = { x: 280, y: 180, width: 120, height: 50 };
const previousRect: Rect = { x: 240, y: 140, width: 180, height: 90 };

describe("buildExitContext", () => {
  test.each(["top-left", "top-right", "bottom-left", "bottom-right"] as const)(
    "keeps viewport rects unchanged for %s",
    (anchor) => {
      const context = buildExitContext(element, currentRect, anchor, currentParent);

      expect(context.element).toBe(element);
      expect(context.anchor).toBe(anchor);
      expect(context.parent).toEqual(currentParent);
      expect(context.rect).toEqual(currentRect);
      expect("insets" in context).toBe(false);
    },
  );
});

describe("defaultExitTransition", () => {
  test("freezes the exiting element at its viewport position", () => {
    let keyframes: Keyframe[] | PropertyIndexedKeyframes | null = null;
    let options: KeyframeAnimationOptions | number | undefined;
    const animatedElement = {
      animate(frames: Keyframe[] | PropertyIndexedKeyframes, animationOptions?: KeyframeAnimationOptions | number) {
        keyframes = frames;
        options = animationOptions;
        return {} as Animation;
      },
    } as unknown as Element;

    defaultExitTransition(buildExitContext(animatedElement, currentRect, "bottom-right", currentParent));

    expect(keyframes).toEqual([
      {
        position: "fixed",
        top: "180px",
        left: "280px",
        opacity: 1,
        transformOrigin: "50% 50%",
        transform: "scale(1, 1)",
        width: "120px",
        height: "50px",
        margin: "0",
      },
      {
        position: "fixed",
        top: "180px",
        left: "280px",
        opacity: 0,
        transformOrigin: "50% 50%",
        transform: "scale(0.96, 0.96)",
        width: "120px",
        height: "50px",
        margin: "0",
      },
    ]);
    expect(options).toEqual({ duration: 250, easing: "ease-in" });
  });
});

describe("buildMoveContext", () => {
  test("keeps geometry in the viewport basis even when the parent changes", () => {
    const context = buildMoveContext(element, currentRect, previousRect, "bottom-right", currentParent, previousParent);

    expect(context.element).toBe(element);
    expect(context.anchor).toBe("bottom-right");
    expect(context.parent).toEqual(currentParent);
    expect(context.current).toEqual(currentRect);
    expect(context.previous).toEqual(previousRect);
    expect(context.currentParent).toEqual(currentParent);
    expect(context.previousParent).toEqual(previousParent);
    expect(context.delta).toEqual({ x: 20, y: 0 });
    expect(context.scale).toEqual({ x: 1.5, y: 1.8 });
  });

  test("does not leak parent shrink into delta when the viewport rect stays fixed", () => {
    const stableRect: Rect = { x: 660, y: 240, width: 80, height: 40 };
    const context = buildMoveContext(
      element,
      stableRect,
      stableRect,
      "bottom-right",
      { x: 640, y: 120, width: 100, height: 160 },
      { x: 600, y: 120, width: 140, height: 160 },
    );

    expect(context.delta).toEqual({ x: 0, y: 0 });
    expect(context.scale).toEqual({ x: 1, y: 1 });
  });
});

describe("TransitionPlugin contexts", () => {
  test("custom plugins can consume precomputed anchor-aware geometry directly", () => {
    const seen: string[] = [];
    const plugin: TransitionPlugin = {
      enter(ctx) {
        expect(ctx.element).toBe(element);
        expect(ctx.parent).toEqual(currentParent);
        expect(ctx.rect).toEqual(currentRect);
        seen.push("enter");
        return {} as Animation;
      },
      exit(ctx) {
        expect(ctx.anchor).toBe("bottom-right");
        expect(ctx.rect).toEqual(currentRect);
        expect("insets" in ctx).toBe(false);
        seen.push("exit");
        return {} as Animation;
      },
      move(ctx) {
        expect(ctx.delta).toEqual({ x: 20, y: 0 });
        expect(ctx.scale).toEqual({ x: 1.5, y: 1.8 });
        expect(ctx.previousParent).toEqual(previousParent);
        expect(ctx.currentParent).toEqual(currentParent);
        seen.push("move");
        return {} as Animation;
      },
    };

    const anchor: Anchor = "bottom-right";
    plugin.enter?.(buildEnterContext(element, currentRect, anchor, currentParent));
    plugin.exit?.(buildExitContext(element, currentRect, anchor, currentParent));
    plugin.move?.(buildMoveContext(element, currentRect, previousRect, anchor, currentParent, previousParent));

    expect(seen).toEqual(["enter", "exit", "move"]);
  });
});
