import type { Rect } from "./AutoTransition.tsx";

export type Anchor = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type AnchorAxis = {
  x: "left" | "right";
  y: "top" | "bottom";
};

export type AnchorPoint = {
  x: number;
  y: number;
};

export type ExitInsets = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

export type ParentBounds = {
  width: number;
  height: number;
};

export type AnchorGeometry = AnchorAxis;

export function resolveAnchor(anchor: Anchor): AnchorGeometry {
  switch (anchor) {
    case "top-right":
      return { x: "right", y: "top" };
    case "bottom-left":
      return { x: "left", y: "bottom" };
    case "bottom-right":
      return { x: "right", y: "bottom" };
    case "top-left":
    default:
      return { x: "left", y: "top" };
  }
}

export function getAnchorPoint(rect: Rect, anchor: Anchor): AnchorPoint {
  const geometry = resolveAnchor(anchor);
  return {
    x: geometry.x === "left" ? rect.x : rect.x + rect.width,
    y: geometry.y === "top" ? rect.y : rect.y + rect.height,
  };
}

export function getAnchorDelta(current: Rect, previous: Rect, anchor: Anchor): AnchorPoint {
  const currentPoint = getAnchorPoint(current, anchor);
  const previousPoint = getAnchorPoint(previous, anchor);
  return {
    x: previousPoint.x - currentPoint.x,
    y: previousPoint.y - currentPoint.y,
  };
}

export function getScaleFactor(previous: number, current: number): number {
  return current === 0 ? 1 : previous / current;
}

export function getExitInsets(rect: Rect, parent: ParentBounds, anchor: Anchor): ExitInsets {
  const geometry = resolveAnchor(anchor);
  return {
    top: geometry.y === "top" ? rect.y : undefined,
    right: geometry.x === "right" ? parent.width - rect.x - rect.width : undefined,
    bottom: geometry.y === "bottom" ? parent.height - rect.y - rect.height : undefined,
    left: geometry.x === "left" ? rect.x : undefined,
  };
}
