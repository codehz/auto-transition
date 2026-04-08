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

| 属性         | 类型               | 默认值       | 说明                                                                                       |
| :----------- | :----------------- | :----------- | :----------------------------------------------------------------------------------------- |
| `as`         | `ElementType`      | `Slot`       | 容器渲染成的 HTML 标签或组件。省略时使用 `@radix-ui/react-slot`。                          |
| `transition` | `TransitionPlugin` | 内置默认动画 | 用于自定义进入、退出和移动动画；每个 phase 都可以单独使用函数或声明式 recipe，也支持混搭。 |
| `patch`      | `boolean`          | `false`      | 是否启用内置 `Activity` 补丁，拦截子节点被强制 `display: none` 的行为。                    |
| `children`   | `ReactNode`        | -            | 需要应用动画的子元素。                                                                     |
| `ref`        | `Ref<HTMLElement>` | -            | 转发给容器 DOM 元素的引用。                                                                |

### 推荐写法：`TransitionPlugin`

如果你只是想快速定制常见的 enter / exit / move 动画，推荐直接使用内置 presets；现在也可以在同一个对象里把 recipe 和函数式 phase 混搭：

```tsx
import { AutoTransition, transitionPresets, type TransitionPlugin } from "@codehz/auto-transition";

const floatingActionsTransition = {
  enter: transitionPresets.enter.slideFade({
    duration: 220,
    distance: 10,
  }),
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
  move: transitionPresets.move.smooth(),
} satisfies TransitionPlugin;

function Example({ children }: { children: React.ReactNode }) {
  return <AutoTransition transition={floatingActionsTransition}>{children}</AutoTransition>;
}
```

`transitionPresets` 目前提供三组常用工厂：

- `transitionPresets.enter.fadeScale(options?)`
- `transitionPresets.enter.fade(options?)`
- `transitionPresets.enter.slideFade(options?)`
- `transitionPresets.enter.pop(options?)`
- `transitionPresets.exit.absoluteFadeScale(options?)`
- `transitionPresets.exit.absoluteFade(options?)`
- `transitionPresets.exit.absoluteSlideFade(options?)`
- `transitionPresets.exit.absoluteShrink(options?)`
- `transitionPresets.move.flip(options?)`
- `transitionPresets.move.translate(options?)`
- `transitionPresets.move.smooth(options?)`

其中：

- `enter.fade()` 只做透明度过渡，适合不希望缩放或位移的内容。
- `enter.slideFade()` / `exit.absoluteSlideFade()` 支持通过 `axis`、`direction`、`distance` 快速做方向性滑入滑出。
- `enter.pop()` 会带一个轻微 overshoot keyframe，适合按钮、标签、浮层等强调进入感的元素。
- `exit.absoluteFadeScale()` 会自动处理退出元素的绝对定位 keyframes，并默认合并 `anchorDelta`。
- `exit.absoluteShrink()` 是更明显一点的离场收缩预设。
- `move.flip()` 会自动使用 `ctx.delta + ctx.anchorDelta`，默认附带缩放补偿；可通过 `includeScale: false` 关闭缩放。
- `move.translate()` 是只保留位移补偿的轻量版 FLIP。
- `move.smooth()` 使用更柔和的 easing 和更长的默认时长，适合卡片、面板这类需要“滑顺”感的布局变化。

如果你想显式地把 `TransitionPlugin` 编译成纯函数式接口，也可以使用 `defineTransition(transition)`；传给 `transition` 时两种写法行为一致。

```ts
import { defineTransition } from "@codehz/auto-transition";

const compiled = defineTransition(floatingActionsTransition);
```

对应的类型如下：

```ts
type TransitionKeyframes<Ctx> =
  | Keyframe[]
  | PropertyIndexedKeyframes
  | ((ctx: Ctx) => Keyframe[] | PropertyIndexedKeyframes);

type TransitionTiming<Ctx> = KeyframeAnimationOptions | ((ctx: Ctx) => KeyframeAnimationOptions);

type TransitionPhaseRecipe<Ctx> = {
  keyframes: TransitionKeyframes<Ctx>;
  options?: TransitionTiming<Ctx>;
};

type TransitionPhaseHandler<Ctx> = (ctx: Ctx) => Animation;

type TransitionPhaseLike<Ctx> = TransitionPhaseHandler<Ctx> | TransitionPhaseRecipe<Ctx>;

type TransitionPlugin = {
  enter?: TransitionPhaseLike<EnterTransitionContext>;
  exit?: TransitionPhaseLike<ExitTransitionContext>;
  move?: TransitionPhaseLike<MoveTransitionContext>;
};
```

为了兼容旧代码，`TransitionLike` 和 `TransitionDefinition` 仍然保留为 `TransitionPlugin` 的类型别名。

如果你希望整个对象都保持声明式，也仍然可以继续使用 `TransitionRecipe`：

```ts
type TransitionRecipe = {
  enter?: TransitionPhaseRecipe<EnterTransitionContext>;
  exit?: TransitionPhaseRecipe<ExitTransitionContext>;
  move?: TransitionPhaseRecipe<MoveTransitionContext>;
};
```

### 兼容写法：纯函数式 `TransitionPlugin`

如果你需要完全控制 `Animation` 对象，旧版函数式插件接口仍然完全可用：

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
  anchorDelta: Point;
  scale: {
    x: number;
    y: number;
  };
};

export type CompiledTransitionPlugin = {
  enter?(ctx: EnterTransitionContext): Animation;
  exit?(ctx: ExitTransitionContext): Animation;
  move?(ctx: MoveTransitionContext): Animation;
};
```

`move` 的 `ctx.delta` 和 `ctx.scale` 已经按标准 FLIP 几何预计算好了；如果父容器因为 `right` / `bottom` 锚定、同一微任务内的 remove / insert / reorder 组合，或 replacement 式的“删旧插新”而在整次提交前后发生净位移，`ctx.anchorDelta` 会额外给出这段测量基准补偿。

### 自定义插件示例

下面这个示例直接使用预计算的 `ctx.delta` 和 `ctx.scale`，同时在退出时使用 `ctx.rect` 固定元素位置，并通过 `ctx.anchorDelta` 补偿当前批次提交前后测量基准产生的整体位移。

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
  move({ element, delta, anchorDelta, scale }) {
    return element.animate(
      {
        transform: [
          `translate(${delta.x + anchorDelta.x}px, ${delta.y + anchorDelta.y}px) scale(${scale.x}, ${scale.y})`,
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
- **Exit**: 冻结元素当前的绝对定位，做轻微中心缩放和淡出；`anchorDelta` 会按同一微任务内整次提交前后的净位移统一结算，因此 replacement 式的“删旧插新”也能保持离场元素的屏幕坐标稳定 (250ms ease-in)。
- **Move**: 使用标准 FLIP，通过基于当前位置的位移补偿配合缩放过渡；当父容器因 `right` / `bottom` 锚定或同批次布局变更而整体平移时，也会自动附加这段批次级位移补偿 (250ms ease-in)。

如果提供了自定义 `transition`，对应的 `enter` / `exit` / `move` hook 或 recipe phase 会优先于内置动画执行。

如果你自定义了 `transition.exit` 或 `transition.move`，推荐把对应的 `ctx.anchorDelta` 合并进 `transform`。不使用这个字段时，普通布局依然可以正常工作，只是在绝对定位父容器通过 `right` / `bottom` 定位、或同批次 replacement / reorder 导致测量基准漂移的场景下不会自动获得位移补偿。replacement 仍然保持 `exit + enter` 语义，而不是旧新元素之间的 morph。

## 许可证

MIT
