# @codehz/auto-transition

一个轻量级的 React 组件库，旨在为容器内的子元素提供自动的**进入 (Enter)**、**退出 (Exit)** 和**移动 (Move)** 动画。

它通过拦截底层的 DOM 操作（如 `appendChild`、`removeChild`）来实现动画，无需开发者手动管理复杂的动画状态。

## 主要功能

- **全自动动画**：自动识别子元素的添加、删除和位置变化并应用动画。
- **高性能**：基于原生 Web Animations API 实现，确保流畅的 160fps 体验。
- **布局感知**：自动计算元素在容器内的相对位置，支持平滑的位移和缩放过渡。
- **高度可定制**：支持通过插件系统自定义动画效果，插件可直接读取预计算的几何上下文。
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

## API 参考

### `AutoTransition` 组件 Props

| 属性         | 类型               | 默认值       | 说明                                                                    |
| :----------- | :----------------- | :----------- | :---------------------------------------------------------------------- |
| `as`         | `ElementType`      | `Slot`       | 容器渲染成的 HTML 标签或组件。省略时使用 `@radix-ui/react-slot`。       |
| `transition` | `TransitionPlugin` | 内置默认动画 | 用于自定义进入、退出和移动动画的插件对象。                              |
| `patch`      | `boolean`          | `false`      | 是否启用内置 `Activity` 补丁，拦截子节点被强制 `display: none` 的行为。 |
| `children`   | `ReactNode`        | -            | 需要应用动画的子元素。                                                  |
| `ref`        | `Ref<HTMLElement>` | -            | 转发给容器 DOM 元素的引用。                                             |

### `TransitionPlugin` 接口

你可以通过实现此接口来自定义动画：

```typescript
type TransitionBaseContext = {
  element: Element;
  parent: ParentBounds;
};

type EnterTransitionContext = TransitionBaseContext & {
  rect: Rect;
};

type ExitTransitionContext = TransitionBaseContext & {
  rect: Rect;
  viewportRect: Rect;
  anchorDelta: Point;
};

type MoveTransitionContext = TransitionBaseContext & {
  current: Rect;
  previous: Rect;
  delta: Point;
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

`move` 的 `ctx.delta` 和 `ctx.scale` 已经按标准 FLIP 几何预计算好了，自定义插件不需要再重复计算位移和缩放。

### 自定义插件示例

下面这个示例直接使用预计算的 `ctx.delta` 和 `ctx.scale`，同时在退出时使用 `ctx.rect` 固定元素位置，并通过 `ctx.anchorDelta` 补偿父容器因为 `right` / `bottom` 锚定而产生的整体位移。

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
  exit({ element, rect, anchorDelta }) {
    const translate =
      anchorDelta.x === 0 && anchorDelta.y === 0 ? "" : `translate(${anchorDelta.x}px, ${anchorDelta.y}px) `;

    return element.animate(
      [
        {
          position: "absolute",
          top: `${rect.y}px`,
          left: `${rect.x}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: "0",
          opacity: 1,
          transform: `${translate}scale(1)`,
        },
        {
          position: "absolute",
          top: `${rect.y}px`,
          left: `${rect.x}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: "0",
          opacity: 0,
          transform: `${translate}scale(0.96)`,
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
- **Exit**: 冻结元素当前的绝对定位，做轻微中心缩放和淡出；当父容器使用 `right` / `bottom` 锚定并因退出而发生位移时，会自动附加平移补偿，保持离场元素的屏幕坐标稳定 (250ms ease-in)。
- **Move**: 使用标准 FLIP，通过基于当前位置的位移补偿配合缩放过渡 (250ms ease-in)。

如果提供了自定义 `transition`，对应的 `enter` / `exit` / `move` hook 会优先于内置动画执行。

如果你自定义了 `transition.exit`，推荐把 `ctx.anchorDelta` 合并进 `transform`。不使用这个字段时，普通布局依然可以正常退出，只是在绝对定位父容器通过 `right` / `bottom` 定位的场景下不会自动获得位移补偿。

## 许可证

MIT
