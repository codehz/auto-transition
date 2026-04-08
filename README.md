# @codehz/auto-transition

一个轻量级的 React 组件库，旨在为容器内的子元素提供自动的**进入 (Enter)**、**退出 (Exit)** 和**移动 (Move)** 动画。

它通过拦截底层的 DOM 操作（如 `appendChild`、`removeChild`）来实现动画，无需开发者手动管理复杂的动画状态。

## 主要功能

- **全自动动画**：自动识别子元素的添加、删除和位置变化并应用动画。
- **高性能**：基于原生 Web Animations API 实现，确保流畅的 160fps 体验。
- **布局感知**：自动计算元素在容器内的相对位置，支持平滑的位移和缩放过渡。
- **锚点感知**：可显式指定 `anchor`，让右侧/底部悬浮容器中的移动和退出动画仍然自然贴边。
- **高度可定制**：支持通过插件系统自定义动画效果，插件可直接读取锚点感知的几何上下文。
- **无侵入性**：支持通过 `Slot` 将行为附着到现有布局节点。

## 安装

该项目依赖于 React 19+。

```bash
npm install @codehz/auto-transition
# 或者使用 bun
bun add @codehz/auto-transition
```

## 快速上手

只需将需要动画的列表或元素包裹在 `AutoTransition` 中即可：

```tsx
import { AutoTransition } from "@codehz/auto-transition";
import { useState } from "react";

function ListExample() {
  const [items, setItems] = useState([1, 2, 3]);

  return (
    <AutoTransition as="ul" className="grid gap-2">
      {items.map((id) => (
        <li key={id} onClick={() => setItems(items.filter((i) => i !== id))}>
          项目 {id} (点击删除)
        </li>
      ))}
      <button onClick={() => setItems([...items, Date.now()])}>添加项目</button>
    </AutoTransition>
  );
}
```

对于右下角悬浮容器这类场景，可以显式指定锚点方向：

```tsx
import { AutoTransition } from "@codehz/auto-transition";

function FloatingActions({ actions }: { actions: string[] }) {
  return (
    <div style={{ position: "fixed", right: 24, bottom: 24 }}>
      <AutoTransition
        as="div"
        anchor="bottom-right"
        style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}
      >
        {actions.map((action) => (
          <button key={action}>{action}</button>
        ))}
      </AutoTransition>
    </div>
  );
}
```

## API 参考

### `AutoTransition` 组件 Props

| 属性         | 类型                                                           | 默认值       | 说明                                                                    |
| :----------- | :------------------------------------------------------------- | :----------- | :---------------------------------------------------------------------- |
| `as`         | `ElementType`                                                  | `Slot`       | 容器渲染成的 HTML 标签或组件。省略时使用 `@radix-ui/react-slot`。       |
| `anchor`     | `"top-left" \| "top-right" \| "bottom-left" \| "bottom-right"` | `top-left`   | 控制内置动画的位移补偿和退出定位。                                      |
| `transition` | `TransitionPlugin`                                             | 内置默认动画 | 用于自定义进入、退出和移动动画的插件对象。                              |
| `patch`      | `boolean`                                                      | `false`      | 是否启用内置 `Activity` 补丁，拦截子节点被强制 `display: none` 的行为。 |
| `children`   | `ReactNode`                                                    | -            | 需要应用动画的子元素。                                                  |
| `ref`        | `Ref<HTMLElement>`                                             | -            | 转发给容器 DOM 元素的引用。                                             |

### `TransitionPlugin` 接口

你可以通过实现此接口来自定义动画：

```typescript
type TransitionBaseContext = {
  element: Element;
  anchor: Anchor;
  parent: ParentBounds;
};

type EnterTransitionContext = TransitionBaseContext & {
  rect: Rect;
};

type ExitTransitionContext = TransitionBaseContext & {
  rect: Rect;
  insets: ExitInsets;
};

type MoveTransitionContext = TransitionBaseContext & {
  current: Rect;
  previous: Rect;
  delta: AnchorPoint;
  scale: {
    x: number;
    y: number;
  };
};

export type TransitionPlugin = {
  enter?(ctx: EnterTransitionContext): Animation;
  exit?(ctx: ExitTransitionContext): Animation;
  move?(ctx: MoveTransitionContext): Animation;
};
```

`move` 的 `ctx.delta` 和 `ctx.scale`、`exit` 的 `ctx.insets` 都已经按 `anchor` 预计算好了，自定义插件不需要再手写 anchor-aware offset。

### 自定义插件示例

下面这个示例适合右下角悬浮按钮组：移动动画直接使用 `ctx.delta`，退出动画直接使用 `ctx.insets` 固定贴边位置。

```tsx
import type { TransitionPlugin } from "@codehz/auto-transition";

const floatingActionsTransition: TransitionPlugin = {
  enter({ element }) {
    return element.animate(
      {
        opacity: [0, 1],
        transform: ["translateY(8px) scale(0.96)", "translateY(0) scale(1)"],
      },
      { duration: 220, easing: "ease-out" },
    );
  },
  exit({ element, rect, insets }) {
    return element.animate(
      [
        {
          position: "absolute",
          right: `${insets.right ?? 0}px`,
          bottom: `${insets.bottom ?? 0}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: "0",
          opacity: 1,
          transform: "scale(1)",
        },
        {
          position: "absolute",
          right: `${insets.right ?? 0}px`,
          bottom: `${insets.bottom ?? 0}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: "0",
          opacity: 0,
          transform: "scale(0.96)",
        },
      ],
      { duration: 200, easing: "ease-in" },
    );
  },
  move({ element, delta, scale }) {
    return element.animate(
      {
        transform: [
          `translate(${delta.x}px, ${delta.y}px) scale(${scale.x}, ${scale.y})`,
          "translate(0, 0) scale(1, 1)",
        ],
      },
      { duration: 220, easing: "ease-in-out" },
    );
  },
};
```

### 默认动画行为

- **Enter**: 以中心做轻微缩放并从透明过渡到完全显示 (250ms ease-out)。
- **Exit**: 按 `anchor` 冻结元素的绝对定位，做轻微中心缩放和淡出，动画结束后从 DOM 移除 (250ms ease-in)。
- **Move**: 使用锚点感知 FLIP，通过基于 `anchor` 的位移补偿配合缩放过渡 (250ms ease-in)。

如果提供了自定义 `transition`，对应的 `enter` / `exit` / `move` hook 会优先于内置锚点动画执行。

## 许可证

MIT
