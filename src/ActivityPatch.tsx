const applied = new WeakSet<HTMLElement>();
const originalStyles = new WeakMap<HTMLElement, CSSStyleDeclaration>();

function isHideDisplay(value: string | null | undefined): boolean {
  return value === "none";
}

function apply(node: HTMLElement) {
  if (applied.has(node)) return;

  const originalStyle = node.style;
  originalStyles.set(node, originalStyle);

  if (isHideDisplay(originalStyle.display)) {
    originalStyle.display = "";
  }

  const proxied = new Proxy(originalStyle, {
    get(target, p, receiver) {
      if (p === "setProperty") {
        return function (this: CSSStyleDeclaration, ...args: Parameters<CSSStyleDeclaration["setProperty"]>) {
          const [property, value] = args;
          if (property === "display" && isHideDisplay(value)) {
            node.inert = true;
            return;
          }
          if (property === "display") {
            node.inert = false;
          }
          return CSSStyleDeclaration.prototype.setProperty.apply(target, args);
        };
      }
      if (p === "removeProperty") {
        return function (this: CSSStyleDeclaration, ...args: Parameters<CSSStyleDeclaration["removeProperty"]>) {
          const [property] = args;
          if (property === "display") {
            node.inert = false;
          }
          return CSSStyleDeclaration.prototype.removeProperty.apply(target, args);
        };
      }
      const value = Reflect.get(target, p, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, p, newValue) {
      if (p === "display") {
        if (isHideDisplay(String(newValue))) {
          node.inert = true;
          return true;
        }
        node.inert = false;
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

function restore(node: HTMLElement) {
  if (!applied.has(node)) return;

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

export type ActivityPatchDisposer = () => void;

/**
 * Intercepts React Activity-style `display: none !important` hiding so exit
 * animations can still run. Returns a disposer that disconnects the observer
 * and restores patched child style objects.
 */
export function patchActivity(element: HTMLElement): ActivityPatchDisposer {
  const patchedChildren = new Set<HTMLElement>();

  function trackAndApply(node: HTMLElement) {
    apply(node);
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
      restore(child);
    }
    patchedChildren.clear();
  };
}
