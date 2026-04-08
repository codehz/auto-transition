import { describe, expect, test } from "bun:test";
import {
  buildEnterContext,
  buildExitContext,
  buildMoveContext,
  type Rect,
  type TransitionPlugin,
} from "./AutoTransition.tsx";
import type { Anchor, ParentBounds } from "./anchor.ts";

const element = { id: "demo" } as unknown as Element;
const parent: ParentBounds = { width: 300, height: 200 };
const currentRect: Rect = { x: 80, y: 60, width: 120, height: 50 };
const previousRect: Rect = { x: 40, y: 20, width: 180, height: 90 };

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
    expect(context.insets).toEqual(expectedInsets);
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
    expect(context.delta).toEqual({ x: 20, y: 0 });
    expect(context.scale).toEqual({ x: 1.5, y: 1.8 });
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
        seen.push("enter");
        return {} as Animation;
      },
      exit(ctx) {
        expect(ctx.anchor).toBe("bottom-right");
        expect(ctx.insets).toEqual({ right: 100, bottom: 90 });
        seen.push("exit");
        return {} as Animation;
      },
      move(ctx) {
        expect(ctx.delta).toEqual({ x: 20, y: 0 });
        expect(ctx.scale).toEqual({ x: 1.5, y: 1.8 });
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
