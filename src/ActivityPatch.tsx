const observer =
  typeof window === "object"
    ? new MutationObserver((entries) => {
        for (const entry of entries) {
          if (entry.type === "childList") {
            entry.addedNodes.forEach((node) => {
              if (node instanceof HTMLElement) {
                apply(node);
              }
            });
          }
        }
      })
    : (null as never);

const applied = new WeakSet();

function apply(node: HTMLElement) {
  if (applied.has(node)) return;
  if (node.style.display === "none") {
    node.style.display = "";
  }
  const proxied = new Proxy(node.style, {
    get(target, p) {
      if (p === "setProperty")
        return function (this: CSSStyleDeclaration, ...args: Parameters<CSSStyleDeclaration["setProperty"]>) {
          if (args[0] === "display" && args[1] === "none" && args[2] === "important") {
            node.inert = true;
            return;
          }
          CSSStyleDeclaration.prototype.setProperty.apply(this, args);
        };
      return Reflect.get(target, p);
    },
    set(target, p, newValue) {
      if (p === "display") {
        node.inert = false;
        return true;
      }
      return Reflect.set(target, p, newValue);
    },
  });
  Object.defineProperty(node, "style", { value: proxied });
  applied.add(node);
}

export function patchActivity(element: HTMLElement) {
  for (const child of element.children) {
    apply(child as HTMLElement);
  }
  observer.observe(element, {
    childList: true,
  });
}
