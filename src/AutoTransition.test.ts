import { describe, expect, test } from "bun:test";
import {
  buildEnterContext,
  buildExitContext,
  buildMoveContext,
  type MeasuredBox,
  type Rect,
  type TransitionPlugin,
} from "./AutoTransition.tsx";
import { measureBox, rectFromBox } from "./anchor.ts";
import type { Anchor, ParentBounds } from "./anchor.ts";

const element = { id: "demo" } as unknown as Element;
const parent: ParentBounds = { width: 300, height: 200 };
const currentRect: Rect = { x: 80, y: 60, width: 120, height: 50 };
const previousRect: Rect = { x: 40, y: 20, width: 180, height: 90 };
const currentBox = measureBox(currentRect, parent);
const previousBox = measureBox(previousRect, parent);

describe("buildEnterContext", () => {
  test("includes the measured box alongside the legacy rect", () => {
    const context = buildEnterContext(element, currentRect, "top-right", parent);

    expect(context.rect).toEqual(currentRect);
    expect(context.box).toEqual(currentBox);
    expect(context.parent).toEqual(parent);
  });
});

describe("buildExitContext", () => {
  test.each([
    ["top-left", { top: 60, left: 80 }],
    ["top-right", { top: 60, right: 100 }],
    ["bottom-left", { bottom: 90, left: 80 }],
    ["bottom-right", { right: 100, bottom: 90 }],
  ] as const)("precomputes anchored insets for %s", (anchor, expectedInsets) => {
    const context = buildExitContext(element, currentRect, anchor, parent);

    expect(context.element).toBe(element);
    expect(context.anchor).toBe(anchor);
    expect(context.parent).toEqual(parent);
    expect(context.rect).toEqual(currentRect);
    expect(context.box).toEqual(currentBox);
    expect(context.beforeBox).toEqual(currentBox);
    expect(context.beforeParent).toEqual(parent);
    expect(context.insets).toEqual(expectedInsets);
  });

  test("keeps before/after parent geometry separate when exit re-bases after detachment", () => {
    const afterParent: ParentBounds = { width: 250, height: 140 };
    const afterBox: MeasuredBox = {
      top: 20,
      right: 40,
      bottom: 50,
      left: 90,
      width: 120,
      height: 70,
    };
    const context = buildExitContext(element, rectFromBox(afterBox), "bottom-right", afterParent, {
      box: afterBox,
      beforeBox: currentBox,
      beforeParent: parent,
    });

    expect(context.parent).toEqual(afterParent);
    expect(context.beforeParent).toEqual(parent);
    expect(context.box).toEqual(afterBox);
    expect(context.beforeBox).toEqual(currentBox);
    expect(context.insets).toEqual({ right: 40, bottom: 50 });
  });
});

describe("buildMoveContext", () => {
  test("keeps geometry on the same measurement basis", () => {
    const context = buildMoveContext(element, currentRect, previousRect, "bottom-right", parent);

    expect(context.element).toBe(element);
    expect(context.anchor).toBe("bottom-right");
    expect(context.parent).toEqual(parent);
    expect(context.current).toEqual(currentRect);
    expect(context.previous).toEqual(previousRect);
    expect(context.currentBox).toEqual(currentBox);
    expect(context.previousBox).toEqual(previousBox);
    expect(context.currentParent).toEqual(parent);
    expect(context.previousParent).toEqual(parent);
    expect(context.delta).toEqual({ x: 20, y: 0 });
    expect(context.scale).toEqual({ x: 1.5, y: 1.8 });
  });

  test("supports previous/current parents with different sizes", () => {
    const currentParent: ParentBounds = { width: 250, height: 140 };
    const currentAnchoredBox: MeasuredBox = {
      top: 20,
      right: 40,
      bottom: 50,
      left: 90,
      width: 120,
      height: 70,
    };
    const previousAnchoredBox: MeasuredBox = {
      top: 20,
      right: 40,
      bottom: 50,
      left: 140,
      width: 120,
      height: 70,
    };

    const context = buildMoveContext(
      element,
      rectFromBox(currentAnchoredBox),
      rectFromBox(previousAnchoredBox),
      "bottom-right",
      currentParent,
      {
        currentBox: currentAnchoredBox,
        previousBox: previousAnchoredBox,
        currentParent,
        previousParent: parent,
      },
    );

    expect(context.delta).toEqual({ x: 0, y: 0 });
    expect(context.scale).toEqual({ x: 1, y: 1 });
    expect(context.currentParent).toEqual(currentParent);
    expect(context.previousParent).toEqual(parent);
  });
});

describe("TransitionPlugin contexts", () => {
  test("custom plugins can consume precomputed anchor-aware geometry directly", () => {
    const seen: string[] = [];
    const plugin: TransitionPlugin = {
      enter(ctx) {
        expect(ctx.element).toBe(element);
        expect(ctx.parent).toEqual(parent);
        expect(ctx.rect).toEqual(currentRect);
        expect(ctx.box).toEqual(currentBox);
        seen.push("enter");
        return {} as Animation;
      },
      exit(ctx) {
        expect(ctx.anchor).toBe("bottom-right");
        expect(ctx.insets).toEqual({ right: 100, bottom: 90 });
        expect(ctx.box).toEqual(currentBox);
        expect(ctx.beforeBox).toEqual(currentBox);
        seen.push("exit");
        return {} as Animation;
      },
      move(ctx) {
        expect(ctx.delta).toEqual({ x: 20, y: 0 });
        expect(ctx.scale).toEqual({ x: 1.5, y: 1.8 });
        expect(ctx.currentBox).toEqual(currentBox);
        expect(ctx.previousBox).toEqual(previousBox);
        seen.push("move");
        return {} as Animation;
      },
    };

    const anchor: Anchor = "bottom-right";
    plugin.enter?.(buildEnterContext(element, currentRect, anchor, parent));
    plugin.exit?.(buildExitContext(element, currentRect, anchor, parent));
    plugin.move?.(buildMoveContext(element, currentRect, previousRect, anchor, parent));

    expect(seen).toEqual(["enter", "exit", "move"]);
  });
});
