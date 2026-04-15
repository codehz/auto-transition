# @codehz/auto-transition

一个轻量级的 React 组件库，用于为容器内的子元素自动添加进入、退出和移动动画。

它通过拦截容器上的 DOM 变更来推导 enter / exit / move，并使用原生 Web Animations API 播放动画。你不需要维护额外的动画状态，也不需要手写 FLIP 细节。

## 安装

该项目依赖 React 19+。

```bash
npm install @codehz/auto-transition
# 或
bun add @codehz/auto-transition
```

## 快速开始

```tsx
import { AutoTransition } from "@codehz/auto-transition";
import { useState } from "react";

function ListExample() {
  const [items, setItems] = useState([1, 2, 3]);

  return (
    <AutoTransition as="ul" className="grid gap-2">
      {items.map((id) => (
        <li key={id} onClick={() => setItems(items.filter((item) => item !== id))}>
          Item {id}
        </li>
      ))}
      <button onClick={() => setItems([...items, Date.now()])}>Add</button>
    </AutoTransition>
  );
}
```

## Declarative API

新版 declarative API 只有两层：

- `preset({ enter, exit, move, timing })`
- `effects.fade()` / `effects.scale()` / `effects.blur()` / `effects.translate()` / `effects.flip()`

```tsx
import { AutoTransition, effects, preset } from "@codehz/auto-transition";

const cardTransition = preset({
  enter: [effects.fade(0), effects.scale(0.96), effects.translate({ x: 0, y: 12 })],
  exit: [effects.fade(0), effects.scale(0.96), effects.translate({ x: 0, y: -8 })],
  move: effects.flip(),
  timing: {
    enter: { duration: 220, easing: "ease-out" },
    exit: { duration: 180, easing: "ease-in" },
    move: { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  },
});

function Example({ children }: { children: React.ReactNode }) {
  return <AutoTransition transition={cardTransition}>{children}</AutoTransition>;
}
```

### 为什么更简单

- 用户只组织一层 `enter / exit / move`
- `translate()` 只传一个偏移量 `{ x, y }`
- `translate()` 支持像素数字和百分比字符串，例如 `{ x: "50%", y: 0 }`
- `scale()` 常见场景只传一个数字
- `blur()` 支持数字，自动转成 `px`
- `exitLayout="absolute"` 和 `exitLayout="flow"` 共用同一套 exit authoring
- `anchorDelta` 和 move FLIP 补偿由运行时自动处理

## Effects

### 从根入口导入

```ts
import { effects } from "@codehz/auto-transition";

effects.fade(0);
effects.scale(0.96);
effects.blur(8);
effects.translate({ x: 0, y: 12 });
effects.flip();
```

### 从子路径按需导入

```ts
import { fade, scale, blur, translate, flip } from "@codehz/auto-transition/effects";
```

### `fade`

```ts
fade();
fade(0);
fade({ value: 0.2 });
fade({
  keyframes: [
    { offset: 0.2, value: 0.1 },
    { offset: 0.7, value: 1 },
  ],
});
```

- `enter: fade(0)` 等价于 `0 -> currentOpacity`
- `exit: fade(0)` 等价于 `currentOpacity -> 0`

### `scale`

```ts
scale();
scale(0.96);
scale({ x: 1.05, y: 0.95 });
scale({
  value: 0.92,
  origin: "50% 0%",
});
```

- `enter: scale(0.96)` 等价于 `0.96 -> 1`
- `exit: scale(0.96)` 等价于 `1 -> 0.96`
- 数字用于等比缩放
- `{ x, y }` 用于非等比缩放

### `blur`

```ts
blur();
blur(8);
blur("0.5rem");
```

- `enter: blur(8)` 等价于 `8px -> 0px`
- `exit: blur(8)` 等价于 `0px -> 8px`
- 数字自动转成 `px`

### `translate`

```ts
translate({ x: 0, y: 12 });
translate({ x: "50%", y: "-25%" });
translate({
  keyframes: [
    { offset: 0, value: { x: 0, y: 12 } },
    { offset: 0.6, value: { x: 0, y: 4 } },
  ],
});
```

- `enter: translate({ x: 0, y: 12 })` 等价于 `{0,12} -> {0,0}`
- `exit: translate({ x: 0, y: -8 })` 等价于 `{0,0} -> {0,-8}`
- 百分比会按元素当前的 `width/height` 解析成像素
- exit 时会自动叠加 `anchorDelta`

### `flip`

```ts
flip();
flip({ scale: false });
flip({ origin: "0 0" });
```

- 仅用于 `move`
- 默认同时处理 translate 和 scale
- `flip({ scale: false })` 只保留位移补偿

## `preset()` API

```ts
type PresetSpec = {
  enter?: EnterEffect | EnterEffect[];
  exit?: ExitEffect | ExitEffect[];
  move?: MoveEffect;
  timing?: {
    enter?: TransitionTiming<EnterTransitionContext>;
    exit?: TransitionTiming<ExitTransitionContext>;
    move?: TransitionTiming<MoveTransitionContext>;
  };
};

declare function preset(spec: PresetSpec): TransitionPlugin;
```

说明：

- `enter` 和 `exit` 支持单个 effect 或数组
- `move` 当前主推单个 `flip()` effect
- `timing` 统一放在根级
- 默认内置动画等价于：
  - `enter: effects.fade(0)`
  - `exit: effects.fade(0)`
  - `move: effects.flip()`

## `exitLayout`

`AutoTransition` 仍然保留：

```tsx
<AutoTransition exitLayout="absolute" />
<AutoTransition exitLayout="flow" />
```

含义：

- `absolute`：退出元素会被冻结到绝对定位，再执行动画
- `flow`：退出元素会在动画结束前继续参与布局

新版 declarative API 不需要为这两种模式分别写两套 preset。运行时会自动根据 `exitLayout` 决定是否注入 absolute layout keyframes。

## Imperative Escape Hatch

如果 declarative `preset()` 还不够，可以继续直接写 `TransitionPlugin` 或用 `defineTransition()` 编译：

```tsx
import {
  AutoTransition,
  buildEnterContext,
  buildExitContext,
  buildMoveContext,
  defineTransition,
  type TransitionPlugin,
} from "@codehz/auto-transition";

const transition = defineTransition({
  enter({ element }) {
    return element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 180,
      easing: "ease-out",
    });
  },
  exit({ element, rect, anchorDelta, layoutMode }) {
    const baseFrames =
      layoutMode === "absolute"
        ? [
            {
              position: "absolute",
              top: `${rect.y}px`,
              left: `${rect.x}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              margin: "0",
            },
            {
              position: "absolute",
              top: `${rect.y}px`,
              left: `${rect.x}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              margin: "0",
            },
          ]
        : [{}, {}];

    const translate =
      anchorDelta.x === 0 && anchorDelta.y === 0 ? "" : `translate(${anchorDelta.x}px, ${anchorDelta.y}px)`;

    return element.animate(
      [
        {
          ...baseFrames[0],
          opacity: 1,
          transform: translate,
        },
        {
          ...baseFrames[1],
          opacity: 0,
          transform: translate,
        },
      ],
      { duration: 180, easing: "ease-in" },
    );
  },
  move({ element, delta, anchorDelta, scale }) {
    return element.animate(
      [
        {
          transformOrigin: "0 0",
          transform: `translate(${delta.x + anchorDelta.x}px, ${delta.y + anchorDelta.y}px) scale(${scale.x}, ${scale.y})`,
        },
        {
          transformOrigin: "0 0",
          transform: "translate(0, 0) scale(1, 1)",
        },
      ],
      { duration: 240, easing: "ease-in" },
    );
  },
} satisfies TransitionPlugin);
```

## 导出概览

根入口：

- `AutoTransition`
- `withAutoTransition`
- `preset`
- `effects`
- `defineTransition`
- `buildEnterContext`
- `buildExitContext`
- `buildMoveContext`
- `getMoveGeometry`
- `getScaleFactor`
- 相关 context / plugin 类型

子路径：

- `@codehz/auto-transition/effects`
  - `fade`
  - `scale`
  - `blur`
  - `translate`
  - `flip`
  - `effects`
