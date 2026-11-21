/**
 * action → 渲染组件 的注册表（**UI 侧**）。
 *
 * ## 为什么在 `src/` 而不是 `dev/`
 *
 * `dev/` 不在 `packages/dsh-client/tsconfig.json` 的 `include` 里（只有 `src/**`）。
 * 而 `src/client.tsx` 的 `apply()` 要在建 React 树**之前**调本文件 —— `src/` 里
 * import `dev/` 直接 `TS6059`（不在 `rootDir` 下）。
 *
 * 本文件是**纯数据结构，零组件 import**（只 import 类型），放 `src/` 没有任何代价。
 *
 * ## 它解决什么问题
 *
 * `core` 知道模板需要哪些 action（`SectionDef.action`），`UI` 知道每个 action 怎么画。
 * 两边**必须对得上**，但它们在两个进程里、编译单元也不同。
 *
 * 设计见 `docs/渲染注册表.md`。四个时刻：
 *
 * | 时刻 | 谁 | 做什么 |
 * |---|---|---|
 * | ① 接通 | core | 比对模板需要的 vs 本文件注册的 ⇒ **警告**（不阻塞）|
 * | ② 平常 | — | 什么也不做 |
 * | ③ 真渲染到没注册的 | UI | **报错** + 红块 + JSON 兜底（这是 bug）|
 * | ④ 兜底 | core | 只读格式化 JSON，永不白屏 |
 *
 * ## 为什么必须显式 `initRenderers()` 而不是「import 即注册」
 *
 * 模块级副作用的问题：`package.json` 一旦加 `"sideEffects": false`（很常见的优化），
 * 或 bundler 判定那个 import 没用 ⇒ **注册静默消失**，界面只是全体降级成 JSON，
 * **没有任何报错**。
 *
 * ⚠ 现状：本包**恰好**没有 `sideEffects` 字段（默认「有副作用」），所以模块级
 * 今天能用。但那是**巧合不是设计** —— `packages/core/package.json` 已经有
 * `"sideEffects": false` 了。谁照着给本包也加一条，模块级注册就全灭。
 *
 * 而这个注册表**存在的意义就是让「缺渲染器」可见**。用一个会静默失效的机制
 * 去实现它，是自相矛盾的。
 *
 * ⇒ 显式 `init()` 的失效方式是「忘了调 ⇒ 零注册」，后果是**吵得要命**
 *   （①报全缺、③每章都红），不会有人上线。
 *
 * ## `sealRegistry()` 为什么必要
 *
 * ① 的结论基于「接通那一刻的注册表」。如果之后还能偷偷注册，
 * ① 的结果就过期了 —— 警告漏报、或者报了一个已经补上的。
 *
 * 封盘后禁止再注册，保证 ① 与 ③ 看到的是**同一份**清单。
 */

import type { ReactNode } from 'react';

import type { CardSection } from './types.ts';

/**
 * 一个 action 渲染器收到的 props。
 *
 * ## 形状抄自 `SectionProps`，不发明新词汇
 *
 * 任务最初写的签名是 `{ payload: unknown; readonly?: boolean }`。
 * **那个签名下 `ask` 注册了也没用** —— 它拿不到 `onAnswer`，选项点不动。
 *
 * 而「发明一套通用的事件机制」（如 `emit(event, data)`）又会引入第二套词表，
 * 那正是被否掉的 AST 方案踩的坑。
 *
 * ⇒ 直接用 `Section` 现在就在用的这套参数：零新词汇，且已经过 90 条 CDP 断言验证。
 *
 * ## ⚠ `readonly` 是**客户端上下文**，不是 payload 的一部分
 *
 * 「用户现在在不在只读视图」由父层决定（卡状态 + 权限 + 视图模式），
 * `core` 不知道。所以它是 prop，不是 payload 字段。
 */
export interface RendererProps {
	/** 章节 id（`Card.sections` 的 key）—— 回调原样带回它。 */
	readonly sectionId: string;
	/** 卡上的章节（`{ label, payload }`）。`payload` 里的 `$type` 是注册键。 */
	readonly section: CardSection;
	/** `true` = 只读显示。省略 = 可编辑。 */
	readonly readonly?: boolean;
	/** 请求编辑这一章（组件**不判**该不该编辑，只上报）。 */
	readonly onEdit?: (sectionId: string) => void;
	/** `ask` 选项被点。`value` 是选项 label；`''`（`NO_ANSWER`）= 都不要。 */
	readonly onAnswer?: (sectionId: string, value: string) => void;

	/* ── 内容渲染需要的额外字段（2026-11-22 合并双层分发时加） ──
	 *
	 * 这些原本只在 Section.tsx 的 SectionContentProps 上。
	 * 现在注册表的组件是「内容组件」（不带章节外壳），所以它们要跟着传。
	 */

	/** pure 判出来的视图（sectionViewOf(payload)）—— 内容组件不用自己再判。 */
	readonly view?: unknown;
	/** 生命周期相位。 */
	readonly phase?: 'create' | 'active' | 'ended';
	/** 内容改回（章节 id + 要合并的字段）。 */
	readonly onChange?: (sectionId: string, patch: Readonly<Record<string, unknown>>) => void;
	/** ask 作答（章节 id + 组下标 + 动作）。 */
	readonly onAsk?: (sectionId: string, groupIndex: number, action: unknown) => void;
}

/** 一个 action 渲染组件。 */
export type RendererComponent = (props: RendererProps) => ReactNode;

/**
 * type → 组件。
 *
 * ⚠ 用 `Map` 而不是普通对象：`$type` 来自不可信的 payload，
 * `{'__proto__': …}` 这种键在普通对象上会污染原型。`Map` 没有这个问题。
 */
const RENDERERS = new Map<string, RendererComponent>();

/** 是否已封盘。封盘后 `registerRenderer` 一律抛。 */
let sealed = false;

/**
 * 注册一个 action 渲染器。
 *
 * ## 三条校验都不是"防御性编程"，各挡一个真 bug
 *
 * | 校验 | 挡什么 |
 * |---|---|
 * | 已封盘 | 运行时偷偷注册 ⇒ ① 的结论过期 |
 * | 空 type | 注册成 `''` 的组件会被「payload 缺 `$type`」误命中 —— 那本该走 ③ 报错路径 |
 * | 重复注册 | 两个组件抢同一 type ⇒ 谁生效取决于 import 顺序 = 不可预测 |
 *
 * @param type payload 的 `$type`（如 `'text'` / `'markdown'` / `'ask'`）
 * @param Comp 渲染组件
 * @throws 已封盘 / type 为空白 / type 重复注册
 */
export function registerRenderer(type: string, Comp: RendererComponent): void {
	if (sealed) {
		throw new Error(
			`渲染器注册表已封盘，不能再注册「${type}」。` +
				'注册表封盘后保证 ① 的检查结果与 ③ 实际用的清单是同一份。',
		);
	}
	if (type.trim() === '') {
		throw new Error(
			'渲染器的 type 不能是空白。' +
				'空 type 会让「payload 没有 $type」的章节误命中一个渲染器，而那种章节应该走 ③ 的报错路径。',
		);
	}
	if (RENDERERS.has(type)) {
		throw new Error(
			`渲染器「${type}」重复注册。` +
				'同一个 type 有两个组件时，谁生效取决于 import 顺序 —— 那是不可预测的行为。',
		);
	}
	RENDERERS.set(type, Comp);
}

/**
 * 查一个 type 的渲染器。
 *
 * @param type payload 的 `$type`
 * @returns 命中的组件；没注册返回 `undefined`（**不抛** —— 由调用方按 ③ 处理）
 */
export function rendererOf(type: string): RendererComponent | undefined {
	return RENDERERS.get(type);
}

/**
 * 已注册的 type 清单（**字母序**）。
 *
 * ## 为什么排序，而不是插入序
 *
 * 这份清单会做两件事，两件都需要**与注册顺序无关**：
 *
 * 1. **① 的比对** —— `core.missingRenderers(required, registered)` 虽是 Set 比对，
 *    但**日志里打印的缺失清单**要和注册顺序无关，否则两次启动日志长得不一样。
 * 2. **测试与快照** —— 插入序取决于 `initRenderers()` 里的书写顺序，
 *    加一个渲染器就会让所有既有快照漂移。
 *
 * 字母序是唯一与「谁先 import」无关的稳定序。
 *
 * @returns 排序后的新数组（调用方改了不影响注册表）
 */
export function registeredTypes(): readonly string[] {
	return [...RENDERERS.keys()].sort();
}

/**
 * 封盘：之后 `registerRenderer` 一律抛。
 *
 * 由 `initRenderers()` 在注册完内置渲染器后调用。
 * **幂等** —— 重复调用不会抛（插件重载时不该报错）。
 */
export function sealRegistry(): void {
	sealed = true;
}

/** 是否已封盘（测试 / 诊断用）。 */
export function isSealed(): boolean {
	return sealed;
}

/**
 * **清空 + 解封** —— 只给测试用。
 *
 * ⚠ 产品代码里调它 = 打破 ① 与 ③ 的一致性保证。
 *
 * 为什么必须能解封：`node --test` 在**同一个进程**里跑整个文件的所有用例。
 * 若封盘不可逆，第二个用例就没法再注册任何东西 —— 只能把所有断言塞进一个
 * `it()` 里，或者在用例之间靠 import 顺序赌运气。两者都是坏测试。
 *
 * 命名带 `__` 前缀和 `ForTest` 后缀，就是为了在 code review 时一眼看见
 * 「这里在绕过产品约束」。
 */
export function __resetRegistryForTest(): void {
	RENDERERS.clear();
	sealed = false;
}
