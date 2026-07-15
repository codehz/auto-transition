type Point = {
  x: number;
  y: number;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BatchParentRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type BatchSnapshot<T> = {
  parent: BatchParentRect;
  rects: Map<T, Rect>;
};

export type PendingExitRecord<T> = {
  node: T;
  rect: Rect;
  viewportRect: Rect;
};

export type PlannedMove<T> = {
  node: T;
  current: Rect;
  previous: Rect;
  anchorDelta: Point;
};

export type PlannedEnter<T> = {
  node: T;
  rect: Rect;
};

export type PlannedExit<T> = {
  node: T;
  rect: Rect;
  viewportRect: Rect;
  anchorDelta: Point;
};

export type BatchAnimationPlan<T> = {
  anchorDelta: Point;
  moves: PlannedMove<T>[];
  enters: PlannedEnter<T>[];
  exits: PlannedExit<T>[];
};

export function getBatchAnchorDelta(
  previousParent: Pick<BatchParentRect, "left" | "top">,
  nextParent: Pick<BatchParentRect, "left" | "top">,
): Point {
  return {
    x: previousParent.left - nextParent.left,
    y: previousParent.top - nextParent.top,
  };
}

/** Sub-pixel threshold used to ignore browser layout noise. */
export const RECT_CHANGE_EPSILON = 0.5;

function hasSignificantDelta(current: number, previous: number, epsilon = RECT_CHANGE_EPSILON): boolean {
  return Math.abs(current - previous) > epsilon;
}

export function hasRectChanged(current: Rect, previous: Rect, epsilon = RECT_CHANGE_EPSILON): boolean {
  return (
    hasSignificantDelta(current.x, previous.x, epsilon) ||
    hasSignificantDelta(current.y, previous.y, epsilon) ||
    hasSignificantDelta(current.width, previous.width, epsilon) ||
    hasSignificantDelta(current.height, previous.height, epsilon)
  );
}

export function planBatchAnimations<T>({
  before,
  after,
  finalNodes,
  pendingEnters,
  pendingExits,
}: {
  before: BatchSnapshot<T>;
  after: BatchSnapshot<T>;
  finalNodes: readonly T[];
  pendingEnters: ReadonlySet<T>;
  pendingExits: ReadonlyMap<T, PendingExitRecord<T>>;
}): BatchAnimationPlan<T> {
  const anchorDelta = getBatchAnchorDelta(before.parent, after.parent);
  const hasAnchorShift = Math.abs(anchorDelta.x) > RECT_CHANGE_EPSILON || Math.abs(anchorDelta.y) > RECT_CHANGE_EPSILON;
  const moves: PlannedMove<T>[] = [];
  const enters: PlannedEnter<T>[] = [];

  for (const node of finalNodes) {
    const current = after.rects.get(node);
    if (!current) continue;

    const previous = before.rects.get(node);
    if (previous) {
      if (hasRectChanged(current, previous) || hasAnchorShift) {
        moves.push({ node, current, previous, anchorDelta });
      }
      continue;
    }

    if (pendingEnters.has(node)) {
      enters.push({ node, rect: current });
    }
  }

  const exits: PlannedExit<T>[] = [];
  for (const exit of pendingExits.values()) {
    exits.push({
      node: exit.node,
      rect: exit.rect,
      viewportRect: exit.viewportRect,
      anchorDelta,
    });
  }

  return { anchorDelta, moves, enters, exits };
}
