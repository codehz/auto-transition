import { describe, expect, test } from "bun:test";
import type { MeasuredBox, Rect } from "./AutoTransition.tsx";
import {
  getAnchorDelta,
  getExitInsets,
  getMoveGeometry,
  getScaleFactor,
  measureBox,
  rectFromBox,
  resolveAnchor,
} from "./anchor.ts";

const currentRect: Rect = { x: 80, y: 60, width: 120, height: 50 };
const previousRect: Rect = { x: 40, y: 20, width: 180, height: 90 };
const parent = { width: 300, height: 200 };

describe("resolveAnchor", () => {
  test.each([
    ["top-left", { x: "left", y: "top" }],
    ["top-right", { x: "right", y: "top" }],
    ["bottom-left", { x: "left", y: "bottom" }],
    ["bottom-right", { x: "right", y: "bottom" }],
  ] as const)("returns the expected geometry for %s", (anchor, geometry) => {
    expect(resolveAnchor(anchor)).toEqual(geometry);
  });
});

describe("getAnchorDelta", () => {
  test.each([
    ["top-left", { x: -40, y: -40 }],
    ["top-right", { x: 20, y: -40 }],
    ["bottom-left", { x: -40, y: 0 }],
    ["bottom-right", { x: 20, y: 0 }],
  ] as const)("computes anchor delta for %s", (anchor, expected) => {
    expect(getAnchorDelta(currentRect, previousRect, anchor)).toEqual(expected);
  });
});

describe("getExitInsets", () => {
  test.each([
    ["top-left", { top: 60, left: 80 }],
    ["top-right", { top: 60, right: 100 }],
    ["bottom-left", { bottom: 90, left: 80 }],
    ["bottom-right", { right: 100, bottom: 90 }],
  ] as const)("computes anchored exit insets for %s", (anchor, expected) => {
    expect(getExitInsets(currentRect, parent, anchor)).toEqual(expected);
  });

  test.each([
    ["top-left", { top: 60, left: 80 }],
    ["top-right", { top: 60, right: 100 }],
    ["bottom-left", { bottom: 90, left: 80 }],
    ["bottom-right", { right: 100, bottom: 90 }],
  ] as const)("accepts measured boxes for %s", (anchor, expected) => {
    expect(getExitInsets(measureBox(currentRect, parent), anchor)).toEqual(expected);
  });
});

describe("getScaleFactor", () => {
  test("returns previous/current for normal sizes", () => {
    expect(getScaleFactor(180, 120)).toBe(1.5);
  });

  test("guards zero-sized current dimensions", () => {
    expect(getScaleFactor(180, 0)).toBe(1);
  });
});

describe("getMoveGeometry", () => {
  test.each([
    ["top-left", { delta: { x: -40, y: -40 }, scale: { x: 1.5, y: 1.8 } }],
    ["top-right", { delta: { x: 20, y: -40 }, scale: { x: 1.5, y: 1.8 } }],
    ["bottom-left", { delta: { x: -40, y: 0 }, scale: { x: 1.5, y: 1.8 } }],
    ["bottom-right", { delta: { x: 20, y: 0 }, scale: { x: 1.5, y: 1.8 } }],
  ] as const)("combines delta and scale for %s", (anchor, expected) => {
    expect(getMoveGeometry(currentRect, previousRect, anchor)).toEqual(expected);
  });

  test("keeps bottom-right anchored delta at zero when only the parent basis shifts", () => {
    const previousBox: MeasuredBox = {
      top: 20,
      right: 40,
      bottom: 50,
      left: 140,
      width: 120,
      height: 30,
    };
    const currentBox: MeasuredBox = {
      top: 20,
      right: 40,
      bottom: 50,
      left: 90,
      width: 120,
      height: 30,
    };

    expect(getMoveGeometry(currentBox, previousBox, "bottom-right")).toEqual({
      delta: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
    });
  });

  test("tracks left-edge movement when the same parent shift is measured from top-left", () => {
    const previousBox: MeasuredBox = {
      top: 20,
      right: 40,
      bottom: 50,
      left: 140,
      width: 120,
      height: 30,
    };
    const currentBox: MeasuredBox = {
      top: 20,
      right: 40,
      bottom: 50,
      left: 90,
      width: 120,
      height: 30,
    };

    expect(getMoveGeometry(currentBox, previousBox, "top-left")).toEqual({
      delta: { x: 50, y: 0 },
      scale: { x: 1, y: 1 },
    });
  });
});

describe("measureBox", () => {
  test("captures all parent-relative edges", () => {
    expect(measureBox(currentRect, parent)).toEqual({
      top: 60,
      right: 100,
      bottom: 90,
      left: 80,
      width: 120,
      height: 50,
    });
  });

  test("round-trips through rectFromBox", () => {
    const box = measureBox(currentRect, parent);
    expect(rectFromBox(box)).toEqual(currentRect);
  });
});
