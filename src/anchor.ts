import type { MeasuredBox, Rect } from "./AutoTransition.tsx";

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

export type MoveGeometry = {
  delta: AnchorPoint;
  scale: {
    x: number;
    y: number;
  };
};

export type AnchorGeometry = AnchorAxis;

function isMeasuredBox(value: Rect | MeasuredBox): value is MeasuredBox {
  return "left" in value;
}

export function measureBox(rect: Rect, parent: ParentBounds): MeasuredBox {
  return {
    top: rect.y,
    right: parent.width - rect.x - rect.width,
    bottom: parent.height - rect.y - rect.height,
    left: rect.x,
    width: rect.width,
    height: rect.height,
  };
}

export function rectFromBox(box: MeasuredBox): Rect {
  return {
    x: box.left,
    y: box.top,
    width: box.width,
    height: box.height,
  };
}

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

export function getAnchorPoint(rect: Rect | MeasuredBox, anchor: Anchor): AnchorPoint {
  const geometry = resolveAnchor(anchor);
  if (isMeasuredBox(rect)) {
    return {
      x: geometry.x === "left" ? rect.left : -rect.right,
      y: geometry.y === "top" ? rect.top : -rect.bottom,
    };
  }
  return {
    x: geometry.x === "left" ? rect.x : rect.x + rect.width,
    y: geometry.y === "top" ? rect.y : rect.y + rect.height,
  };
}

export function getAnchorDelta(current: Rect | MeasuredBox, previous: Rect | MeasuredBox, anchor: Anchor): AnchorPoint {
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

export function getMoveGeometry(
  current: Rect | MeasuredBox,
  previous: Rect | MeasuredBox,
  anchor: Anchor,
): MoveGeometry {
  return {
    delta: getAnchorDelta(current, previous, anchor),
    scale: {
      x: getScaleFactor(previous.width, current.width),
      y: getScaleFactor(previous.height, current.height),
    },
  };
}

export function getExitInsets(box: MeasuredBox, anchor: Anchor): ExitInsets;
export function getExitInsets(rect: Rect, parent: ParentBounds, anchor: Anchor): ExitInsets;
export function getExitInsets(
  rectOrBox: Rect | MeasuredBox,
  parentOrAnchor: ParentBounds | Anchor,
  maybeAnchor?: Anchor,
): ExitInsets {
  const box =
    maybeAnchor === undefined
      ? (rectOrBox as MeasuredBox)
      : measureBox(rectOrBox as Rect, parentOrAnchor as ParentBounds);
  const anchor = (maybeAnchor ?? parentOrAnchor) as Anchor;
  const geometry = resolveAnchor(anchor);
  return {
    top: geometry.y === "top" ? box.top : undefined,
    right: geometry.x === "right" ? box.right : undefined,
    bottom: geometry.y === "bottom" ? box.bottom : undefined,
    left: geometry.x === "left" ? box.left : undefined,
  };
}
