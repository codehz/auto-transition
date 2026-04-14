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

| 属性         | 类型                   | 默认值       | 说明                                                                                                     |
| :----------- | :--------------------- | :----------- | :------------------------------------------------------------------------------------------------------- |
| `as`         | `ElementType`          | `Slot`       | 容器渲染成的 HTML 标签或组件。省略时使用 `@radix-ui/react-slot`。                                        |
| `transition` | `TransitionPlugin`     | 内置默认动画 | 用于自定义进入、退出和移动动画；每个 phase 都可以单独使用函数或 effect 组合式定义，也支持混搭。          |
| `exitLayout` | `"absolute" \| "flow"` | `"absolute"` | 退出元素的布局策略。`absolute` 会冻结位置并立即脱离文档流；`flow` 会让元素在退出动画结束前继续参与布局。 |
| `patch`      | `boolean`              | `false`      | 是否启用内置 `Activity` 补丁，拦截子节点被强制 `display: none` 的行为。                                  |
| `children`   | `ReactNode`            | -            | 需要应用动画的子元素。                                                                                   |
| `ref`        | `Ref<HTMLElement>`     | -            | 转发给容器 DOM 元素的引用。                                                                              |

### 推荐写法：`TransitionPlugin`

新版推荐把动画拆成可组合的 effect，再用 phase 工厂拼成 enter / exit / move。这样 `fade`、`scale`、`blur`、`slide`、FLIP 补偿都可以自由组合，不需要继续堆 `fadeScaleBlurSlide...` 这类预设名。

```tsx
import {
  AutoTransition,
  defineTransition,
  transitionEffects,
  transitionPhases,
  type TransitionPlugin,
} from "@codehz/auto-transition";

const floatingActionsTransition = defineTransition({
  enter: transitionPhases.enter(
    transitionEffects.common.fade({ from: 0, to: 1 }),
    transitionEffects.common.scale({ from: 0.96, to: 1 }),
    transitionEffects.common.blur({ from: "8px", to: "0px" }),
    transitionEffects.enter.slide({ axis: "y", distance: 10 }),
    { duration: 220, easing: "ease-out" },
  ),
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
  move: transitionPhases.move(transitionEffects.move.flipTranslate(), transitionEffects.move.flipScale(), {
    duration: 320,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  }),
} satisfies TransitionPlugin);

function Example({ children }: { children: React.ReactNode }) {
  return <AutoTransition transition={floatingActionsTransition}>{children}</AutoTransition>;
}
```

如果你的布局使用了明确的 `grid-area` 或其他“元素位置本来就固定”的槽位式布局，可以打开 `flow` 退出模式：

```tsx
import { AutoTransition, transitionPresets } from "@codehz/auto-transition";

function DashboardGrid({ children }: { children: React.ReactNode }) {
  return (
    <AutoTransition
      as="section"
      className="grid"
      exitLayout="flow"
      transition={{ exit: transitionPresets.exit.fade() }}
    >
      {children}
    </AutoTransition>
  );
}
```

`exitLayout="flow"` 的语义是“退出元素在动画结束前继续参与布局”。这很适合 `grid-area` 这类固定槽位，但不适合希望其他元素在删除瞬间立即补位并触发 move 动画的列表场景。

可组合 API 分成两层：

- `transitionEffects.common.fade(options?)`
- `transitionEffects.common.scale(options?)`
- `transitionEffects.common.blur(options?)`
- `transitionEffects.enter.slide(options?)`
- `transitionEffects.exit.anchorTranslate(options?)`
- `transitionEffects.move.flipTranslate(options?)`
- `transitionEffects.move.flipScale(options?)`
- `transitionPhases.enter(...effects, options?)`
- `transitionPhases.exit.flow(...effects, options?)`
- `transitionPhases.exit.absolute(...effects, options?)`
- `transitionPhases.move(...effects, options?)`

其中：

- `transitionEffects.common.fade()` 负责 opacity 时间线，值会相对元素当前 opacity 缩放。
- `transitionEffects.common.scale()` 负责结构化的 `transform.scale`，会自动输出固定顺序的 transform 字符串。
- `transitionEffects.common.blur()` 首版封装 `filter: blur(...)`，后续可以自然扩到更多 filter 片段。
- `transitionEffects.enter.slide()` 负责进入时的位移片段。
- `transitionEffects.exit.anchorTranslate()` 负责退出时的 `anchorDelta` 补偿，也可附带额外滑出距离。
- `transitionEffects.move.flipTranslate()` / `flipScale()` 把 FLIP 的位移补偿和缩放补偿拆成两个独立 effect。
- `transitionPhases.exit.flow()` 会保留退出节点的普通布局参与，effect 只关注视觉属性本身。
- `transitionPhases.exit.absolute()` 会自动注入退出时需要的绝对定位 keyframe 基座，effect 只关注视觉属性本身。

effect 合并规则：

- 所有效果的 `offset` 会取并集并按升序输出。
- 中间缺失值会沿用最近一次已知值；起点和终点缺失时，会分别用首个和末个已知值补齐。
- `transform` 固定按 `translate -> scale` 合成。
- `filter` 当前固定按 `blur()` 合成。
- 两个 effect 不能同时控制同一个原子字段，例如 `opacity`、`transform.scale`、`filter.blur`；冲突会直接抛错。

`transitionPresets` 仍然保留，作为新组合 API 之上的薄封装，适合快速使用常见动画：

- `transitionPresets.enter.fadeScale(options?)`
- `transitionPresets.enter.fade(options?)`
- `transitionPresets.enter.slideFade(options?)`
- `transitionPresets.enter.pop(options?)`
- `transitionPresets.exit.fadeScale(options?)`
- `transitionPresets.exit.fade(options?)`
- `transitionPresets.exit.slideFade(options?)`
- `transitionPresets.exit.shrink(options?)`
- `transitionPresets.exit.absoluteFadeScale(options?)`
- `transitionPresets.exit.absoluteFade(options?)`
- `transitionPresets.exit.absoluteSlideFade(options?)`
- `transitionPresets.exit.absoluteShrink(options?)`
- `transitionPresets.move.flip(options?)`
- `transitionPresets.move.translate(options?)`
- `transitionPresets.move.smooth(options?)`

其中：

- `enter.fade()` 只做透明度过渡，适合不希望缩放或位移的内容。
- 默认内置 `enter` / `exit` 分别使用 `transitionPresets.enter.fade()` 和退出布局对应的淡出预设；`exitLayout="absolute"` 时是 `transitionPresets.exit.absoluteFade()`，`exitLayout="flow"` 时是 `transitionPresets.exit.fade()`。
- `exit.fade()` / `exit.fadeScale()` / `exit.slideFade()` / `exit.shrink()` 适合不希望退出元素被强制切到绝对定位的布局。
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
type TransitionTiming<Ctx> = KeyframeAnimationOptions | ((ctx: Ctx) => KeyframeAnimationOptions);

type EffectFrame = {
  offset: number;
  opacity?: number;
  transform?: {
    translate?: Point;
    scale?: { x: number; y: number };
  };
  filter?: {
    blur?: string;
  };
  transformOrigin?: string;
  style?: Partial<Keyframe>;
};

type TransitionPhaseHandler<Ctx> = (ctx: Ctx) => Animation;

type TransitionEffect<Ctx> = {
  build(ctx: Ctx): EffectFrame[];
};

type TransitionPhaseDefinition<Ctx> = {
  effects: TransitionEffect<Ctx>[];
  options?: TransitionTiming<Ctx>;
};

type TransitionPhaseLike<Ctx> = TransitionPhaseHandler<Ctx> | TransitionPhaseDefinition<Ctx>;

type TransitionPlugin = {
  enter?: TransitionPhaseLike<EnterTransitionContext>;
  exit?: TransitionPhaseLike<ExitTransitionContext>;
  move?: TransitionPhaseLike<MoveTransitionContext>;
};
```

### 兼容写法：纯函数式 `TransitionPlugin`

如果你需要完全控制 `Animation` 对象，函数式 phase 仍然完全可用：

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
  layoutMode: "absolute" | "flow";
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

下面这个示例直接使用预计算的 `ctx.delta` 和 `ctx.scale`，同时在退出时根据 `ctx.layoutMode` 决定是否固定元素位置，并通过 `ctx.anchorDelta` 补偿当前批次提交前后测量基准产生的整体位移。

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
  exit({ element, rect, anchorDelta, layoutMode }) {
    const translate =
      anchorDelta.x === 0 && anchorDelta.y === 0 ? "" : `translate(${anchorDelta.x}px, ${anchorDelta.y}px) `;
    const absoluteBase =
      layoutMode === "absolute"
        ? {
            position: "absolute" as const,
            top: `${rect.y}px`,
            left: `${rect.x}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            margin: "0",
          }
        : {};

    return element.animate(
      [
        {
          ...absoluteBase,
          opacity: 1,
          transform: `${translate}scale(1)`,
        },
        {
          ...absoluteBase,
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

- **Enter**: 默认只做透明度淡入，不附带缩放 (250ms ease-out)。
- **Exit**: 默认会根据 `exitLayout` 选择退出布局策略。`absolute` 会冻结元素当前的绝对定位并淡出；`flow` 会保持元素继续参与布局直到退出动画结束。两种模式下 `anchorDelta` 都会按同一微任务内整次提交前后的净位移统一结算 (250ms ease-in)。
- **Move**: 使用标准 FLIP，通过基于当前位置的位移补偿配合缩放过渡；当父容器因 `right` / `bottom` 锚定或同批次布局变更而整体平移时，也会自动附加这段批次级位移补偿 (250ms ease-in)。

如果提供了自定义 `transition`，对应的 `enter` / `exit` / `move` hook 或 effect phase 会优先于内置动画执行。

如果你自定义了 `transition.exit` 或 `transition.move`，推荐把对应的 `ctx.anchorDelta` 合并进 `transform`。不使用这个字段时，普通布局依然可以正常工作，只是在绝对定位父容器通过 `right` / `bottom` 定位、或同批次 replacement / reorder 导致测量基准漂移的场景下不会自动获得位移补偿。replacement 仍然保持 `exit + enter` 语义，而不是旧新元素之间的 morph。

## 许可证

MIT
