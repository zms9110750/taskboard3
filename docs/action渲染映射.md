# action → 渲染映射的归属

> **状态：设计（未实现）。** 等用户确认后派实现任务。
>
> 用户 `2026-11-18` 的裁定：
> > 「这个映射应该在模板包里面。也就是就跟 action 放在一起。
> >   然后考虑他的映射类型是什么。是 html mdx，jsx，还是 react 这个框架组建格式。」
>
> **最后核对：2026-11-18**

---

## 零、先摆清约束（不解决这些，方案都是空的）

我读了代码确认了五条硬约束。它们决定了所有方案的可行边界。

### 约束 1：`core` 里没有 React，也不能有

```
packages/core/package.json  dependencies: @taskboard/protocol, yaml, zod
packages/core/tsconfig.json types: ["node"]
```

`core` 跑在 **Host 侧（Node）**。加 React 进 `core` 的依赖 = 让 Host 侧加载一个浏览器 UI 框架。
**这条不可协商。**

⇒ 任何「映射函数返回 JSX / React 组件」的方案**直接出局**，不管它多优雅。

### 约束 2：`core` 和 `dsh-client` 之间隔着 HTTP，函数过不去

`dsh-client/src/types.ts:1-14` 已经写死了这条原因：

> `core` 会 `import 'node:sqlite'` —— 那是 Node 内置模块，浏览器里不存在。
> 一旦本包 import core，bundler 会尝试解析 `node:sqlite`，客户端 bundle 直接炸。

⇒ 就算 `core` 里的映射函数产出的是**纯数据**，**函数本身也过不了线**。
  要么它在 Host 上跑完、只把**输出**发过来，要么客户端自己能算出同样的东西。

### 约束 3：`ask` 是**可交互**的，纯静态描述不够

`dev/components/AskSection.tsx` 现在有三条交互路径（`onAnswer` 回调）：

```
点选项   → onAnswer(sectionId, option.label)
点都不要 → onAnswer(sectionId, NO_ANSWER)      // NO_ANSWER === ''
自填提交 → onAnswer(sectionId, 输入的文字)
```

⇒ 描述里必须能表达「这里有个可点的东西，点了发出事件 E，载荷是 P」。
  但**不能是函数**（过不了线）。所以需要一个「事件名 + 载荷」的机制。

**这是整个设计的关键难点，比「不能引 React」更隐蔽。**

### 约束 4：`readonly` 不是 payload 的一部分，是客户端上下文

`Section.tsx:76` 现在的判决：

```ts
const clickToEdit = canEditOf(readonlyFlag, props.onEdit !== undefined) && view.kind !== 'ask';
```

`readonly` 由父层灌进来（卡状态 + 权限 + 用户当前视图模式）。
**Host 不知道「用户现在在不在只读视图里」** ⇒ 描述里**不能**编码「可不可编辑」。

⇒ 描述只描述**结构**；「这个结构现在能不能点」由客户端在渲染时叠加。

### 约束 5：`describe` 这个名字已经被占了

`packages/core/src/template/types.ts:130` 已经有：

```ts
export function describe(template: TemplateDef): TemplateMeta
```

⇒ 新字段不能叫 `describe`，否则读代码的人要在两个「describe」之间猜。
**本设计用 `describeNodes`。**

---

## 一、五个方案对比

| # | 方案 | core 里可行 | 能过 HTTP | 可 `node --test` | 加新 action 改几个包 | 安全性 |
|---|---|---|---|---|---|---|
| 1 | **HTML 字符串**<br>`renderHtml(payload) => string` | ✅ 可行（就是字符串） | ✅ | ⚠ 要 DOMParser 或字符串比对 | 1（core） | ❌ 浏览器侧得 `dangerouslySetInnerHTML` |
| 2 | **MDX**<br>每个 action 一个 `.mdx` | ❌ 要构建期编译 | ❌ | ❌ | — | — |
| 3 | **React 组件**<br>`Component: FC<Props>` | ❌ `core` 无 React | ❌ 函数过不去 | ❌ | 1 但污染 core | ✅ 但做不到 |
| 4 | **纯数据节点树**<br>`describeNodes(payload) => RenderNode[]` | ✅ | ✅ | ✅ | **1（core）** | ✅ 白名单结构 |
| 5 | **共享映射包**<br>`packages/render` 两端都 import | ✅ | ⚠ 内置可以，第三方不行 | ✅ | 2（core + render） | ✅ |

### 逐条说清

**方案 1（HTML 字符串）—— 可行但踩两条红线**

技术上最简单：`renderHtml(payload)` 返回 `'<div class="md">…</div>'`。

但浏览器侧只能：

```tsx
<div dangerouslySetInnerHTML={{ __html: html }} />
```

⇒ 和你已经定过的**两条安全原则直接冲突**：

1. `dev/components/Markdown.tsx:22` 明确写着：「**不 `innerHTML`**」，整个 markdown 白名单
   （`markdown-tokens.ts` 46 条单测含 12 条 XSS 用例）就是为了绕开 `innerHTML`。
2. `dev/components/Section.tsx:29` 写着：「**本文件永远不用 `dangerouslySetInnerHTML`**」。

引入方案 1 = 把已经拆掉的地雷重新埋回去，而且是**从模板包任意位置**埋 ——
比 markdown 更危险，因为 markdown 至少只有一处入口。

**出局。**

**方案 2（MDX）—— 不可行**

MDX 要在**构建期**编译成 JS。`core` 是运行时（Host 上跑着的 Node 进程），
没有构建步骤。第三方模板注册一个 `.mdx` 也没法在运行时编译。
**出局。**

**方案 3（React 组件）—— 不可行**

`core` 不能 import React（约束 1）。而且就算能，函数不能过 HTTP（约束 2）。
**出局。**

**方案 4（纯数据节点树）—— 推荐**

`core` 只产出**描述**，`dsh-client` 有一个「描述 → React」的渲染器。

这套模式**这个仓库里已经有一个成功先例**：`dev/pure/markdown-tokens.ts`。

```ts
export const MD_TAGS = ['p', 'br', 'h1', …, 'span'] as const;   // 白名单常量
export type MdTag = (typeof MD_TAGS)[number];                    // 编译期收窄
export interface MdElement { kind: 'element'; tag: MdTag; props: MdProps; children: MdNode[] }
export type MdNode = MdText | MdElement;
```

`Markdown.tsx` 只做 `MdNode → ReactNode` 的 1:1 映射，安全靠**类型**而不是运行时检查：

> - `MdElement.tag` 的类型是 `MdTag` ⇒ **不可能**渲染出白名单外的标签，这是**编译期**保证
> - 属性只来自 `MdProps` ⇒ 结构上就没有 `onClick` / `dangerouslySetInnerHTML` 这类位置

⇒ 这套「节点树 + 白名单类型 + 薄渲染器」已经在生产用了（marked 46 条单测）。
**action 渲染直接复用同一个模式，不是发明新东西。**

**方案 5（共享映射包）—— 看起来更简单，但只覆盖一半**

把 `describeNodes` 放进 `packages/render`，两端都 import：

- `core` 注册 action 时用它
- `dsh-client` 直接调用它 ⇒ **不用改 HTTP，不用传描述**

⚠ **但它只对内置 action 成立。** 第三方模板在 Host 上注册 action 时，
它的 `describeNodes` 是 Host 侧的代码，浏览器拿不到 ⇒ 还是得过线。

⇒ 结果是**两套路径**：内置走共享包、第三方走 HTTP。两条路都要维护、都要测，
而且「某天一个内置 action 变成第三方」时行为会悄悄改变。

⚠ **还有一条更硬的理由**：新建包要改 `pnpm-workspace.yaml`、给 `core` 和
`dsh-client` 各加一条 workspace 依赖、还要处理 `tsc -b` 的 project references。
而放 `protocol` **零依赖改动**（`dsh-client` 已经依赖它）。**投入产出不划算。**

**本设计选择方案 4（单一 HTTP 路径）**，把「共享包」当作可选优化，不当骨架。

---

## 二、推荐：纯数据节点树 + 事件槽

一句话：**`core` 把 payload 翻译成「节点树 + 事件槽」，`dsh-client` 有一台渲染器把它画成 React，槽位由客户端接到自己的回调上。**

### 为什么事件槽能解决约束 3

问题：`ask` 要可点，但函数过不了 HTTP。

解法：描述里放的不是函数，是**「事件名 + 载荷」**：

```ts
{ kind: 'slot', slot: 'answer', label: '望文生义', payload: { value: '望文生义' } }
```

客户端渲染器拿到 `slot: 'answer'`，就调 `props.onAnswer(payload.value)`。

⇒ `core` 不知道回调长什么样，也不需要知道。
⇒ 描述是**纯 JSON**，能过线、能存库、能单测、能 diff。
⇒ 新增**交互种类**要两端都改（`slot` 是封闭词表）—— 但这比「新增 action 类型」少得多，
   而且封闭词表正好逼你想清楚「这是一个新交互，还是一种新内容」。

### 代价要说清

| 得到的 | 付出的 |
|---|---|
| core 保持零 UI 依赖 | 描述要过线 ⇒ 多一次 HTTP 往返（或塞进卡响应）|
| 描述可单测（`node --test`，不起浏览器）| 70 条 section 测试要从 `dev/` 搬到 core（见第六节）|
| 加新 action 只改 core 一个包 | 加新**交互种类**要改 protocol + core + client 三个包 |
| 结构上不可能 XSS（没有 HTML 字符串）| 渲染器多一层间接，调试时要在两个地方看 |
| 第三方 action 也能渲染 | 描述体积可能不小（markdown 一棵树）|

---

## 三、类型定义

### 3.1 节点词汇放 `protocol`（不是 core）

理由：`core`（生产）和 `dsh-client`（消费）都要认识这些类型，
而 `dsh-client` **不能 import core**（约束 2）。

`protocol` 是「零运行时依赖、可进浏览器」的纯词汇包 —— 和 `status.ts` / `transition.ts`
同一性质。渲染词汇（标签名、槽位名、类名）**也是不会变的词汇**。

⚠ **而且不需要动任何 `package.json`**：`dsh-client/package.json:32` 已经写了
`"@taskboard/protocol": "workspace:*"`。放 protocol 是**零依赖改动**；
放新包则要给两端各加一条依赖并处理 workspace 链接。

⚠ 这不违背用户「映射跟 action 放在一起」：
**映射函数（`describeNodes`）在 core 里跟 action 放一起**；
**节点词汇是两端共用的类型，放 protocol**。一个是实现，一个是词表。

`packages/protocol/src/render.ts`：

```ts
/* ── 元素标签白名单（编译期收窄，和 MD_TAGS 同一套思路）── */
export const RENDER_TAGS = [
  'div', 'span', 'p', 'br',
  'strong', 'em', 'del', 'code', 'pre',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'button', 'input', 'label', 'textarea',
] as const;
export type RenderTag = (typeof RENDER_TAGS)[number];

/* ── 类名白名单 ──
 * ⚠ 为什么不用 `string`：任意类名 = 任意 CSS = 一个 action 能改全站观感。
 *   封闭枚举让「这个 action 长什么样」也在 review 范围内。 */
export const RENDER_CLASSES = [
  'section-text', 'section-placeholder', 'section-unknown',
  'md', 'md-line',
  'ask-block', 'ask-question', 'ask-option', 'ask-option__label',
  'ask-option__desc', 'ask-none', 'ask-custom',
] as const;
export type RenderClass = (typeof RENDER_CLASSES)[number];

/* ── 属性白名单 ── */
export const RENDER_PROP_KEYS = ['class', 'disabled', 'placeholder', 'type'] as const;
export type RenderPropKey = (typeof RENDER_PROP_KEYS)[number];
export type RenderProps = Readonly<Partial<Record<RenderPropKey, string | boolean>>>;

/* ── 事件槽词表（封闭）── */
export const SLOT_NAMES = [
  'answer',      // ask 选项被点 / 都不要 / 自填提交，payload: { value }
  'edit',        // 请求编辑这一章
] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/* ── 三种节点 ── */
export interface RenderText {
  readonly kind: 'text';
  readonly value: string;
}

export interface RenderElement {
  readonly kind: 'element';
  readonly tag: RenderTag;
  readonly props?: RenderProps;
  readonly children?: readonly RenderNode[];
}

/** 事件槽 —— **不是组件**，是「这里有个可交互点，点了发这个」。 */
export interface RenderSlot {
  readonly kind: 'slot';
  readonly slot: SlotName;
  /** 槽位自己的文案（button 的 label、input 的 placeholder 走 props）。 */
  readonly label?: string;
  /** 点了要回传的载荷（纯 JSON）。 */
  readonly payload?: Readonly<Record<string, string>>;
}

export type RenderNode = RenderText | RenderElement | RenderSlot;

/** 一个章节的完整描述。`title` 为空 = 不画标题行（用户 2026-11-15 的裁定）。 */
export interface SectionRender {
  readonly title: string;
  readonly nodes: readonly RenderNode[];
}
```

### 3.2 映射函数签名

`packages/core/src/template/render-types.ts`（core 内部，不导出到 protocol）：

```ts
import type { RenderNode } from '@taskboard/protocol';

/**
 * 把一个 payload 描述成节点树。
 *
 * ## 硬要求
 * - **纯函数**：同样输入必须给同样输出（可缓存、可单测、可 diff）
 * - **输出必须是 JSON 安全的**：它要过 HTTP（约束 2），不能含函数/undefined/Symbol
 * - **必须容忍任意 `unknown`**：core 的 `validate()` 第 ④ 步把模板 `default`
 *   **不校验**就塞进卡（`template/schema.ts` 的 `defaultsOf`）⇒ 第三方模板能给任意
 *   payload、任意 `$type`。**不能抛**，要给出能画的东西（降级成 JSON 预览）。
 * - **不编码 `readonly`**：那是客户端上下文（约束 4），描述只管结构。
 *
 * @param payload 卡上的 payload（任意形状）
 * @returns 节点树（永远非空 —— 至少给一个降级块）
 */
export type DescribeNodes = (payload: unknown) => readonly RenderNode[];
```

### 3.3 `ActionDef` 的改动

```ts
export interface ActionDef {
  readonly $type: string;
  readonly summary: string;
  readonly payloadSchema: ZodType;
  readonly defaultPayload: unknown;
  /**
   * 怎么把 payload 画成节点树。**必填。**
   *
   * 见 `render-types.ts` 的 `DescribeNodes` 四条硬要求。
   * 不想自定义就写 `describeNodes: jsonPreviewDescribe`（core 导出），
   * 那是一行明确的「我选择降级显示 JSON」，不是一个遗漏。
   */
  readonly describeNodes: DescribeNodes;
}
```

#### `describeNodes` 要不要必填 —— 我的判断：**必填**

| 选项 | 好处 | 坏处 |
|---|---|---|
| **必填**（推荐） | 加 action 必须想清楚怎么渲染 | 旧注册方会红 |
| 可选 + 静默降级 | 不破坏兼容 | **正是现在这个 bug 的成因** |

现在的洞就长这样（`dev/pure/section.ts` 的 `payloadKindOf`）：

```ts
// 未知 $type ⇒ 回落 'unknown' ⇒ 画成未知块
```

**没有报错，没有告警，界面只是显示得不对。** 加一个新 action 忘了改 UI，
直到有人打开那张卡才会发现。这正是用户说「两边靠 `$type` 字符串硬连」要解决的问题。

⚠ 关于「第三方模板的旧 action 会全红」：
- 这个仓库现在的 action 注册方**只有 `BUILTIN_ACTIONS` 三个**（`core/src/index.ts:467`），
  没有外部注册者 ⇒ 破坏面为零。
- 而且 `ActionRegistry.register()` **本来就会抛**一堆东西（名字非法 / 已注册 /
  `defaultPayload.$type` 不匹配），加一条「必须有 describeNodes」完全一致。
- **给懒人一个明确出口**：`describeNodes: jsonPreviewDescribe`。一行，可 grep，
  code review 时一眼看到「这里主动放弃了自定义渲染」。

⇒ **必填 + 提供 `jsonPreviewDescribe` 作为显式降级。**

---

## 四、`dsh-client` 那一侧：一台渲染器

### 4.1 渲染器（薄，和 `Markdown.tsx` 同构）

`packages/dsh-client/dev/components/RenderTree.tsx`：

```tsx
export interface RenderTreeProps {
  readonly nodes: readonly RenderNode[];
  /** 槽位回调表 —— 描述里有 slot，就从这个表里找处理器。 */
  readonly onSlot?: (slot: SlotName, payload: Readonly<Record<string, string>>) => void;
  /** 槽位是否可交互（readonly 由客户端决定，见约束 4）。 */
  readonly interactive?: boolean;
}

export function RenderTree(props: RenderTreeProps): ReactNode { … }
```

内部就是一个 `switch (node.kind)`，三个分支：

| `node.kind` | 渲染成 |
|---|---|
| `text` | `node.value`（**字符串子节点**，不是 HTML） |
| `element` | `createElement(node.tag, mappedProps, children.map(…))` |
| `slot` | `interactive ? <button onClick={…}>` : `<span>`（只读态显示成不可点） |

**关键：`switch` 是穷尽的（`node.kind` 只有三种），加第四种节点类型 `tsc` 会报错。**
这是编译期保证，不是运行时判断。

### 4.2 客户端还需要什么

```ts
// 卡响应里带上描述
interface CardSectionWire {
  readonly label: string;
  readonly payload: unknown;
  readonly render: SectionRender;   // ← 新增，Host 算好的
}
```

⇒ HTTP 侧要改的是：`GET /api/cards/:id`（以及任何返回整卡的响应）在序列化卡时
顺带调 `describeNodes`。core 应该提供一个 `renderSection(section): SectionRender`，
dsh 的 `http.ts` 调它。

⚠ **列表视图（`CardRow`）不需要描述** —— 它只画标题/状态/时间。
所以可以只在「详情」类响应里带描述，避免 `/api/state` 变胖。
具体放哪条路由见第六节迁移步骤 3。

### 4.3 客户端不再需要的东西

| 现在 | 迁移后 |
|---|---|
| `dev/pure/section.ts` 的 `sectionViewOf` / `payloadKindOf` / `askSectionOf` / `markdownLinesOf` | **删掉**（都搬到 core 的 `describeNodes` 里） |
| `dev/components/Section.tsx` 的 `switch (view.kind)` | 换成 `<RenderTree nodes={section.render.nodes} />` |
| `dev/components/AskSection.tsx` 的 payload 解析 | 只剩「槽位处理器」（`answer` → `onAnswer`）|
| `src/pure.ts` 的 `extractText()`（已知缺陷） | **一起解决** —— 它只在客户端「猜 payload」时才有意义，搬家后没人调 |

---

## 五、四个方案在 core 里的可行性（复核表）

| 方案 | 会不会污染 Host | 能不能过线 | 白名单安全 | 结论 |
|---|---|---|---|---|
| HTML 字符串 | 不会 | 能 | ❌ 要 `dangerouslySetInnerHTML` | 出局 |
| MDX | — | — | — | 运行时不支持，出局 |
| React 组件 | ❌ | ❌ | — | 出局 |
| **纯数据节点树** | 不会 | 能 | ✅ | **采用** |
| 共享映射包 | 不会 | 部分 | ✅ | 作为可选优化 |

---

## 六、迁移路径（六步，每步可独立验收）

### 第 1 步：加词汇（不改任何行为）

- `protocol/src/render.ts` —— 上面的类型定义 + 白名单常量
- `protocol/src/index.ts` 重导出
- 测试：白名单常量是 `as const` 元组（AGENTS 3.5 的「裸字面量元组 + widen 导出」）
- **验收**：`tsc -b` 过，其他包零改动，全仓测试条数不变

### 第 2 步：加渲染器（不改任何行为）

- `dsh-client/dev/pure/render-tree.ts` —— `RenderNode` 的校验/清洗（脏数据不炸）
- `dsh-client/dev/components/RenderTree.tsx` —— 节点 → React
- 测试：每种节点、脏数据、`slot` 在 `interactive=false` 时不渲染成 button
- **验收**：新组件有自己的预览页 + CDP 断言；**老路径一行没动**

### 第 3 步：core 加 `describeNodes`（关键一步）

- `core/src/template/describe.ts` —— 三个内置 action 的 `describeNodes` + `jsonPreviewDescribe`
- `ActionDef` 加必填字段，`register()` 校验
- `core/src/index.ts` 加 `renderSection(section): SectionRender`
- 测试：**把 `dev/test/section.test.ts` 的 70 条搬过来**（见下面「搬迁成本」）
- **验收**：core 测试全绿，**`dsh-client` 还没接**

### 第 4 步：HTTP 加字段

- `dsh/src/http.ts` 的卡序列化函数里加 `render`
- 决定**放哪条路由**（建议先只放 `GET /api/cards/:id` + `GET /api/cards/:id/...` 类，
  列表 `GET /api/state` 先不带 —— 列表不需要描述）
- `dsh-client/src/types.ts` 的 `CardSection` 加可选 `render`
- **验收**：HTTP 测试断言响应里有 `render.nodes`

### 第 5 步：客户端切过去

- `dev/components/Section.tsx` 改成 `<RenderTree>`
- `dev/components/AskSection.tsx` 只剩槽位处理
- 删 `dev/pure/section.ts` 的形态判决（保留纯工具）
- **验收**：section 预览页视觉与 CDP 断言不变（除了 DOM 细节），
  旧断言里 `data-section-kind` 这类要重新设计

### 第 6 步：清理

- 删 `src/pure.ts` 的 `extractText()`（`task-32` 直接取消）
- 删 `dev/test/section.test.ts` 里那条「已知缺陷」红测试
- 更新 `docs/组件清单.md`

⚠ **`extractText()` 现在有两个调用方，都在 `dev/` 里，都跟着本设计一起消失**：

```
dev/pure/section.ts:441       const value = … extractText(payload)
dev/pure/card-detail.ts:409   const text = extractText(section.payload)
```

⇒ 前一个是「text 章节取正文」，后一个是「详情页每章取一句摘要」。
两者迁移后都改成读 `render` 描述（前一个直接 `<RenderTree>`，
后一个取描述里的第一个 `text` 节点）。

⇒ **`task-32`（修 `extractText` 认 v3 的 ask 形状）应该直接取消。**
修一个马上要被删的函数是浪费 —— 除非本设计被否，那就还得修。

### 搬迁成本（必须提前说）

`dev/test/section.test.ts` 现在 **70 条**测试，测的是「client 侧怎么解释 payload」。
搬到 core 之后它们测的是「core 侧怎么描述 payload」——
**断言要重写成对节点树的断言，不是简单挪文件。**

估计：70 条里约 50 条的语义不变（输入 payload，输出「应该有什么内容」），
20 条关心 DOM 细节（`data-*` 属性、CSS 类）要重新设计。

**这是这个方案最大的实际成本，不是设计成本。**

---

## 七、风险 / 我不确定的地方

### 风险 1：描述体积可能失控（中等）

markdown 一棵完整节点树（marked GFM）比原始源码大很多。
一张卡 5 个章节全是长 markdown ⇒ 描述可能到几百 KB。

**缓解**：只在详情路由带描述；可以考虑 `describeNodes` 按需（点开才请求）。
**不确定**：要不要现在就加 `/api/sections/:id/render` 这种「按需渲染」路由，
还是先在详情响应里一次给全。**我倾向前者先不做，等真的慢了再说。**

### 风险 2：`readonly` 与描述分离可能出 bug（中等）

描述说「这里有个 `answer` 槽」，但客户端因为只读不渲染成 button ⇒ 界面上有文字没按钮。
这是**对的**（只读就该没按钮），但如果槽位文案只在 `slot.label` 里，
只读态就成了「一句没有按钮的孤零零文字」。

**不确定**：只读态的槽位该长什么样？现在 `AskSection` 的做法是「显示选中的那个 + 不给点」。
⇒ 描述里可能要同时带「可交互形态」和「只读形态」的描述，
   或者客户端自己把 `slot` 降级成一个 `text`。**这个要用户定视觉。**

### 风险 3：`slot` 词表是新的双包耦合点（低但会长大）

虽然比「每个 action 一个耦合」小得多，但 `SLOT_NAMES` 是封闭的：

- 加一个新交互（比如「拖拽排序」「附件上传」）⇒ protocol + core + client 三处改
- 好处：`tsc` 会强制你三处都改（穷尽 switch）
- 坏处：多了一个「想加功能要跨包」的点

**这是有意用「可控的耦合点」换掉「不可控的字符串硬连」。** 我认为划算。

### 风险 4：`RenderClass` 白名单可能太紧（低）

我列了 11 个类名。做 `CardCreate`（1389 行，6 个部件）时大概率不够用，
到时要么加（走 protocol 改动），要么放开成 `string`。

**不确定**：现在收紧、以后放开，和现在放开、以后收不回 —— **哪个更痛？**
我倾向现在收紧（收紧容易放，放开难收）。

### 风险 5：第三方 action 的 `describeNodes` 注册位置（我还没想清）

`ActionRegistry.register()` 在 Host 上跑。第三方插件注册 action 时提供的
`describeNodes` 是 **Host 侧代码**，所以描述**必须**由 Host 算并过线 —— 方案 4 已覆盖。

**但**：如果将来 MCP 侧也要渲染（用户提过 MCP 是二期），
MCP 是独立进程，走的是和 dsh 一样的 HTTP ⇒ 同一套 `render` 字段能用。
**这条我判断没问题，但没验证过 MCP 的通道形态。**

### 风险 6：`jsonPreviewDescribe` 会变成垃圾桶（低）

「不想想怎么渲染」的人都写它 ⇒ 界面上出现一堆 JSON 块。
**缓解**：它输出的块带明显的警示样式 + 把 `$type` 显示出来，
让「这个 action 没做渲染」在界面上可见，而不是假装正常。

---

## 八、需要用户裁定的三件事

1. **方案 4（节点树）还是方案 1（HTML 字符串）？**
   我强烈推荐 4。如果选 1，等于把已经拆掉 12 条 XSS 测试守着的地雷埋回去。

2. **`describeNodes` 必填，还是可选 + 静默降级？**
   我推荐必填（配 `jsonPreviewDescribe` 作显式降级）。
   选可选 = 保留现在这个「静默回落 unknown」的洞。

3. **`RenderClass` 现在就收紧成封闭枚举，还是先放 `string`？**
   我推荐收紧（风险 4）。但如果你觉得「以后每加个样式都要改 protocol」太难受，
   可以现在放开。
