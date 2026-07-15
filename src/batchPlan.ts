/**
 * DOM-free transition batch planner.
 *
 * Classifies enter / exit / move from before/after geometry snapshots and a
 * mutation ledger. Layout measurement and style writes stay outside this module.
 *
 * ## Correctness contracts
 *
 * 1. **Move**: node in `before ∩ after` with significant rect change **or** parent
 *    anchor shift → `moves`.
 * 2. **Enter**: node in `after` only and listed in `pendingEnters` → `enters`.
 * 3. **Exit**: entries remaining in `pendingExits` at flush → `exits`
 *    (caller must cancel reinserts from the ledger before planning).
 * 4. **Same-batch reinsert**: remove+insert of a node present in `before` cancels
 *    the exit in the ledger; the node then follows the move path via (1).
 * 5. **Absolute exit occupancy**: planner does not simulate layout. Absolute exits
 *    must be freeze-committed before the `after` snapshot so sibling displacement
 *    appears in `after.rects` and becomes moves.
 * 6. **Flow exit**: exit nodes stay in normal flow until removal; sibling moves
 *    only appear if real layout shifted them.
 * 7. **Sub-pixel noise**: deltas ≤ {@link RECT_CHANGE_EPSILON} are ignored for move.
 * 8. **Reduced motion**: not handled here — commit layer skips playback.
 *
 * ## Geometry
 *
 * Parent content-box origin may shift between snapshots (margin collapse, scroll,
 * sibling layout outside the container, etc.). Compensation:
 *
 * ```
 * anchorDelta = before.parent.leftTop - after.parent.leftTop
 * moveInvertTranslate = (previous.xy - current.xy) + anchorDelta
 * ```
 *
 * `flip()` and exit `translate()` apply the same `anchorDelta` so elements do not
 * visually drift when only the measured parent origin moved.
 */

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

/**
 * Invert translate used by move FLIP after parent-origin compensation.
 * Matches `effects.flip()`: `(previous - current) + anchorDelta`.
 */
export function getCompensatedMoveTranslate(
  current: Pick<Rect, "x" | "y">,
  previous: Pick<Rect, "x" | "y">,
  anchorDelta: Point,
): Point {
  return {
    x: previous.x - current.x + anchorDelta.x,
    y: previous.y - current.y + anchorDelta.y,
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

export function hasAnchorShift(anchorDelta: Point, epsilon = RECT_CHANGE_EPSILON): boolean {
  return hasSignificantDelta(anchorDelta.x, 0, epsilon) || hasSignificantDelta(anchorDelta.y, 0, epsilon);
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
  const parentShifted = hasAnchorShift(anchorDelta);
  const moves: PlannedMove<T>[] = [];
  const enters: PlannedEnter<T>[] = [];

  for (const node of finalNodes) {
    const current = after.rects.get(node);
    if (!current) continue;

    const previous = before.rects.get(node);
    if (previous) {
      if (hasRectChanged(current, previous) || parentShifted) {
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
