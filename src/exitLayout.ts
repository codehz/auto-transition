import type { ExitLayoutMode, Rect } from "./transitionTypes.ts";

type LockedStyleState = {
  position: string;
  top: string;
  left: string;
  right: string;
  bottom: string;
  width: string;
  height: string;
  margin: string;
  pointerEvents: string;
};

export type PreparedExitState = {
  layoutMode: ExitLayoutMode;
  restore(node: Element): void;
};

function lockNodeForAbsoluteExit(node: Element, rect: Rect): LockedStyleState {
  const style = (node as HTMLElement).style;
  const lockedStyles = {
    position: style.position,
    top: style.top,
    left: style.left,
    right: style.right,
    bottom: style.bottom,
    width: style.width,
    height: style.height,
    margin: style.margin,
    pointerEvents: style.pointerEvents,
  };
  style.position = "absolute";
  style.top = `${rect.y}px`;
  style.left = `${rect.x}px`;
  style.right = "auto";
  style.bottom = "auto";
  style.width = `${rect.width}px`;
  style.height = `${rect.height}px`;
  style.margin = "0";
  style.pointerEvents = "none";
  return lockedStyles;
}

function restoreLockedNode(node: Element, lockedStyles: LockedStyleState) {
  const style = (node as HTMLElement).style;
  style.position = lockedStyles.position;
  style.top = lockedStyles.top;
  style.left = lockedStyles.left;
  style.right = lockedStyles.right;
  style.bottom = lockedStyles.bottom;
  style.width = lockedStyles.width;
  style.height = lockedStyles.height;
  style.margin = lockedStyles.margin;
  style.pointerEvents = lockedStyles.pointerEvents;
}

export function prepareNodeForExit(node: Element, rect: Rect, layoutMode: ExitLayoutMode): PreparedExitState {
  if (layoutMode === "flow") {
    return {
      layoutMode,
      restore() {},
    };
  }

  const lockedStyles = lockNodeForAbsoluteExit(node, rect);
  return {
    layoutMode,
    restore(restoreTarget: Element) {
      restoreLockedNode(restoreTarget, lockedStyles);
    },
  };
}

export function restorePreparedExitNode(node: Element, preparedExit: PreparedExitState) {
  preparedExit.restore(node);
}
