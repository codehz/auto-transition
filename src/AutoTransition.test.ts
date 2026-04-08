import { describe, expect, test } from "bun:test";
import {
  buildEnterContext,
  buildExitContext,
  buildMoveContext,
  getMoveGeometry,
  getScaleFactor,
  type Rect,
  type ParentBounds,
  type TransitionPlugin,
} from "./AutoTransition.tsx";

const element = { id: "demo" } as unknown as Element;
const parent: ParentBounds = { width: 300, height: 200 };
const currentRect: Rect = { x: 80, y: 60, width: 120, height: 50 };
const previousRect: Rect = { x: 40, y: 20, width: 180, height: 90 };

describe("buildExitContext", () => {
  test("keeps element geometry relative to the measured parent", () => {
    const context = buildExitContext(element, currentRect, parent);

    expect(context.element).toBe(element);
    expect(context.parent).toEqual(parent);
    expect(context.rect).toEqual(currentRect);
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
