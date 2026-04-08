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

export function hasRectChanged(current: Rect, previous: Rect): boolean {
  return (
    current.x !== previous.x ||
    current.y !== previous.y ||
    current.width !== previous.width ||
    current.height !== previous.height
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
  const moves: PlannedMove<T>[] = [];
  const enters: PlannedEnter<T>[] = [];

  for (const node of finalNodes) {
    const current = after.rects.get(node);
    if (!current) continue;

    const previous = before.rects.get(node);
    if (previous) {
      if (hasRectChanged(current, previous) || anchorDelta.x !== 0 || anchorDelta.y !== 0) {
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
