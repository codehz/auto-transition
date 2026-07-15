const applied = new WeakSet<HTMLElement>();
const originalStyles = new WeakMap<HTMLElement, CSSStyleDeclaration>();

export type ActivityPatchMode = "inert" | "exit";

export type ActivityPatchOptions = {
  mode?: ActivityPatchMode;
  /**
   * `exit` mode only. Called when Activity requests hide (`display: none`).
   * The node stays painted until the returned promise settles (or immediately if void),
   * then the patch applies the real hidden styles.
   */
  onHide?: (node: HTMLElement) => void | Promise<void>;
  /**
   * `exit` mode only. Called after the node has been made visible again so enter
   * animations can measure and run.
   */
  onShow?: (node: HTMLElement) => void | Promise<void>;
};

export type ActivityPatchDisposer = () => void;

type NodePhase = "visible" | "hiding" | "hidden" | "showing";

type NodeController = {
  phase: NodePhase;
  /** Bumped to invalidate in-flight hide/show completions. */
  generation: number;
};

function isHideDisplay(value: string | null | undefined): boolean {
  return value === "none";
}

function applyFinalHide(originalStyle: CSSStyleDeclaration, node: HTMLElement) {
  originalStyle.setProperty("display", "none", "important");
  node.inert = true;
}

function clearFinalHide(originalStyle: CSSStyleDeclaration, node: HTMLElement) {
  originalStyle.removeProperty("display");
  node.inert = false;
}

function apply(node: HTMLElement, options: ActivityPatchOptions, controllers: WeakMap<HTMLElement, NodeController>) {
  if (applied.has(node)) return;

  const mode: ActivityPatchMode = options.mode ?? "inert";
  const originalStyle = node.style;
  originalStyles.set(node, originalStyle);

  const controller: NodeController = {
    phase: "visible",
    generation: 0,
  };
  controllers.set(node, controller);

  const initiallyHidden = isHideDisplay(originalStyle.display);
  if (initiallyHidden) {
    if (mode === "inert") {
      originalStyle.display = "";
      node.inert = true;
      controller.phase = "hidden";
    } else {
      // Sync hidden state without playing an exit animation.
      applyFinalHide(originalStyle, node);
      controller.phase = "hidden";
    }
  }

  function requestHide() {
    if (controller.phase === "hiding" || controller.phase === "hidden") {
      return;
    }

    controller.generation += 1;
    const generation = controller.generation;
    controller.phase = "hiding";
    node.inert = true;

    if (mode === "inert") {
      // Keep current compatibility behavior: never apply display:none, only inert.
      controller.phase = "hidden";
      return;
    }

    const finish = () => {
      if (controllers.get(node)?.generation !== generation) return;
      applyFinalHide(originalStyle, node);
      controller.phase = "hidden";
    };

    try {
      const result = options.onHide?.(node);
      if (result != null && typeof (result as PromiseLike<void>).then === "function") {
        Promise.resolve(result).then(finish, finish);
        return;
      }
    } catch {
      // Fall through to immediate hide if the hook throws.
    }
    finish();
  }

  function requestShow() {
    if (controller.phase === "visible" || controller.phase === "showing") {
      return;
    }

    controller.generation += 1;
    const generation = controller.generation;

    if (mode === "inert") {
      node.inert = false;
      controller.phase = "visible";
      return;
    }

    clearFinalHide(originalStyle, node);
    controller.phase = "showing";

    const finish = () => {
      if (controllers.get(node)?.generation !== generation) return;
      controller.phase = "visible";
    };

    try {
      const result = options.onShow?.(node);
      if (result != null && typeof (result as PromiseLike<void>).then === "function") {
        Promise.resolve(result).then(finish, finish);
        return;
      }
    } catch {
      // Fall through to visible if the hook throws.
    }
    finish();
  }

  const proxied = new Proxy(originalStyle, {
    get(target, p, receiver) {
      if (p === "setProperty") {
        return function (this: CSSStyleDeclaration, property: string, value: string | null, priority?: string) {
          if (property === "display" && isHideDisplay(value)) {
            requestHide();
            return;
          }
          if (property === "display") {
            requestShow();
          }
          // Call the underlying method without requiring the CSSStyleDeclaration global
          // (tests may run without a DOM prototype chain).
          return target.setProperty(property, value ?? "", priority);
        };
      }
      if (p === "removeProperty") {
        return function (this: CSSStyleDeclaration, property: string) {
          if (property === "display") {
            requestShow();
          }
          return target.removeProperty(property);
        };
      }
      if (p === "display" && (controller.phase === "hidden" || controller.phase === "hiding")) {
        // Report the Activity-requested value even while we delay applying it.
        return "none";
      }
      const value = Reflect.get(target, p, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, p, newValue) {
      if (p === "display") {
        if (isHideDisplay(String(newValue))) {
          requestHide();
          return true;
        }
        requestShow();
        return Reflect.set(target, p, newValue);
      }
      return Reflect.set(target, p, newValue);
    },
  });

  Object.defineProperty(node, "style", {
    configurable: true,
    enumerable: true,
    value: proxied,
  });
  applied.add(node);
}

function restore(node: HTMLElement, controllers: WeakMap<HTMLElement, NodeController>) {
  if (!applied.has(node)) return;

  const controller = controllers.get(node);
  if (controller) {
    controller.generation += 1;
    controllers.delete(node);
  }

  const originalStyle = originalStyles.get(node);
  if (originalStyle) {
    Object.defineProperty(node, "style", {
      configurable: true,
      enumerable: true,
      value: originalStyle,
    });
    originalStyles.delete(node);
  }

  node.inert = false;
  applied.delete(node);
}

/**
 * Intercepts React Activity-style `display: none` hiding.
 *
 * - `inert` (default): map hide to `inert` only, preserving previous behavior.
 * - `exit`: keep the node paint-able for exit animation, then apply real hide;
 *   reverse on show so enter animation can run.
 *
 * Returns a disposer that disconnects the observer and restores patched child style objects.
 */
export function patchActivity(element: HTMLElement, options: ActivityPatchOptions = {}): ActivityPatchDisposer {
  const patchedChildren = new Set<HTMLElement>();
  const controllers = new WeakMap<HTMLElement, NodeController>();

  function trackAndApply(node: HTMLElement) {
    apply(node, options, controllers);
    patchedChildren.add(node);
  }

  for (const child of element.children) {
    if (child instanceof HTMLElement) {
      trackAndApply(child);
    }
  }

  const observer = new MutationObserver((entries) => {
    for (const entry of entries) {
      if (entry.type !== "childList") continue;
      entry.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          trackAndApply(node);
        }
      });
    }
  });

  observer.observe(element, {
    childList: true,
  });

  return () => {
    observer.disconnect();
    for (const child of patchedChildren) {
      restore(child, controllers);
    }
    patchedChildren.clear();
  };
}

/** Normalize `AutoTransition` patch prop into an ActivityPatch mode. */
export function resolvePatchMode(patch: boolean | ActivityPatchMode | undefined): ActivityPatchMode | undefined {
  if (patch === true || patch === "inert") return "inert";
  if (patch === "exit") return "exit";
  return undefined;
}
