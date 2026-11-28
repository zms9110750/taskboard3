/**
 * 章节的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * ## 数据形状（v3，不是旧版）
 *
 * payload 的形状**唯一来源**是 `core/template/actions.ts` 的 zod schema（三个内置
 * action，全部 `strictObject`）：
 *
 * | action | payload |
 * |---|---|
 * | `text` | `{ $type:'text', value?: string, placeholder?: string }` |
 * | `markdown` | `{ $type:'markdown', value?: string, placeholder?: string }` |
 * | `ask` | `{ $type:'ask', items: [{ header?, question?, options: [{label, description?}], multi_select?, picked?: string[], custom?: string[], placeholder? }] }` |
 *
 * 真实样例见 `packages/core/templates/*.yaml`（如 `expectedMismatch.yaml` 的
 * 「为什么这么想」、`question.yaml` 的「需要回答的问题」）。
 *
 * ⚠ **旧版的形状不一样**：taskboard2 的 ask 是 `{ title, case:[…] }`。`src/pure.ts`
 *   的 `extractText()` 认的是**旧形状** ⇒ 对 v3 的 ask 返回空串（已知缺陷，
 *   另派任务修；`dev/test/section.test.ts` 有一条**会变红**的测试钉住它）。
 *
 * ## 为什么这里还要容忍脏数据
 *
 * core 的 `validate()` 第 ④ 步把模板 `default` **不校验**就塞进卡
 * （`template/schema.ts` 的 `defaultsOf`）⇒ 第三方模板能给出任意 payload、任意
 * `$type`。卡是 JSON、TypeScript 不校验运行时数据 ⇒ **本文件的每个入口都必须
 * 对任意 `unknown` 给出一个能画的东西，不抛**。
 *
 * 判决（哪些形状怎么画）全在这里；组件只把这里给的字段原样画出来。
 */

import { extractText } from '../pure.ts';

/* ══════════════════════════════════════════════════════════
   基础：把 unknown 收窄
   ══════════════════════════════════════════════════════════ */

/** 普通对象（排除 null / 数组）。 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 取一个字符串字段；不是字符串就给 `''`（**不 String() 强转**，那会把数字画成内容）。 */
function stringField(record: Readonly<Record<string, unknown>>, key: string): string {
	const value = record[key];
	return typeof value === 'string' ? value : '';
}

/* ══════════════════════════════════════════════════════════
   类型判定
   ══════════════════════════════════════════════════════════ */

/** 章节内容的四种渲染形态。`unknown` 是**降级**，不是第四种 action。 */
export type SectionKind = 'text' | 'markdown' | 'ask' | 'unknown';

/**
 * 取 `$type`。不是字符串就给 `''`。
 *
 * @param payload 任意 payload
 */
export function payloadTypeOf(payload: unknown): string {
	if (!isRecord(payload)) return '';
	return stringField(payload, '$type');
}

/**
 * payload → 渲染形态。
 *
 * ## 三条兼容（都有测试钉住）
 *
 * 1. `$type` 是三个已知值 ⇒ 对应形态；
 * 2. `$type` 是**别的**字符串 ⇒ `unknown`（**不猜**：第三方 action 的 UI 没接，
 *    硬画成文本会让「未注册」这个事实看不见）；
 * 3. 没有 `$type` 但 `value` 是字符串 / payload 本身就是字符串 ⇒ `text`
 *    —— 与 `extractText()` 已有的行为一致（旧数据 / 未校验的模板默认值）。
 *
 * @param payload 任意 payload
 */
export function payloadKindOf(payload: unknown): SectionKind {
	if (typeof payload === 'string') return 'text';

	const type = payloadTypeOf(payload);
	if (type === 'text' || type === 'markdown' || type === 'ask') return type;
	if (type !== '') return 'unknown';

	if (isRecord(payload) && typeof payload['value'] === 'string') return 'text';
	return 'unknown';
}

/* ══════════════════════════════════════════════════════════
   ask
   ══════════════════════════════════════════════════════════ */

/**
 * `picked` 的三种状态（`core/template/actions.ts` 的注释原文）：
 * 不存在 = 未选择；`[]` = 看了但都不要；`["A"]` = 选了 A。
 *
 * ⚠ 三态**必须能区分显示** —— `[]` 和「不存在」是两种不同的回答。
 */
export type AskPickState = 'unset' | 'none' | 'picked';

/** 一个选项的渲染决定。 */
export interface AskOptionView {
	readonly label: string;
	readonly description: string;
	/** 这个选项当前被选中（`picked` 里有它的 label）。 */
	readonly picked: boolean;
}

/** 一个问卷组（一个问题 + 它的选项 + 已答）。 */
export interface AskGroupView {
	readonly header: string;
	readonly question: string;
	readonly multiSelect: boolean;
	readonly options: readonly AskOptionView[];
	/** 三态之一。 */
	readonly pickedState: AskPickState;
	/** 已选数量（`picked` 里合法字符串的个数）。 */
	readonly pickedCount: number;
	/** 自填值（不进 `picked`）。 */
	readonly custom: readonly string[];
	/**
	 * 「其它（自己填）」这一行**是否被选中** —— **派生值，不是 payload 字段**。
	 *
	 * action 架构在 `packages/core/src/template/actions.ts` 的 `askItemSchema`，
	 * 里面只有 `picked` / `custom`，**没有** `custom_active`。
	 * `picked` 的定义是「选中的选项 label + 被选中的自填文字」，
	 * 所以「自填行选中」= `picked` 里有一个**不是任何选项 label** 的值。
	 */
	readonly customActive: boolean;
	/** 自填框灰字。 */
	readonly placeholder: string;
	/** 可画的东西一个都没有（无 header / question / options / custom）。 */
	readonly empty: boolean;
}

/** 一个 ask 章节。 */

/**
 * ask 的一次作答动作。
 *
 * 替代原来含糊的 `onAnswer(sectionId, value: string)` —— 那个签名用 `''`
 * 同时表示「都不要」和「未选择」，父层没法区分，是胶水的根源。
 */
export type AskAction =
	| { readonly type: 'pick'; readonly label: string }
	| { readonly type: 'clear' }
	| { readonly type: 'custom-toggle' }
	| { readonly type: 'custom-input'; readonly text: string };

/**
 * 一次作答动作 → **该组 payload 的补丁**。
 *
 * 单选互斥、保留自填文字、未选择只清答案 —— 这些规则**全在这一个函数里**，
 * 组件和父层都不重复判断。父层拿到补丁后 merge 进 `items[index]` 写库即可。
 *
 * 规则来源：taskboard2 `docs/02-action.md:488-500`。
 *
 * @param group 当前组（判断单选/多选、上次的选择）
 * @param action 用户的动作
 * @returns 要 merge 进该组的字段；`undefined` 值表示**删掉这个字段**
 */
export function askPatchOf(
	group: AskGroupView,
	action: AskAction,
): Readonly<Record<string, unknown>> {
	/*
	 * ⚠ 只能写 `askItemSchema` 里有的字段（`packages/core/src/template/actions.ts`）：
	 *   header / question / options / multi_select / picked / custom / placeholder
	 *
	 * 它没有 `custom_active`。「自填行选中」在架构里就表达成
	 * **`picked` 里有一个不是任何选项 label 的值**（= 被选中的自填文字）。
	 */
	const text = group.custom[0] ?? '';
	/** `picked` 去掉自填文字（单选互斥 / 换选时用）。 */
	const withoutCustom = group.options.filter((one) => one.picked).map((one) => one.label);

	switch (action.type) {
		case 'pick': {
			/*
			 * 单选：替换旧的（自填文字一并让位）。
			 * 多选：同 label 再点 = 取消，否则追加；**自填文字必须保留**
			 *   —— 多选里自填和选项是共存的，不能因为点了个选项就把自填挤掉。
			 */
			if (!group.multiSelect) return { picked: [action.label] };
			const nextOptions = group.options
				.filter((one) => one.picked !== (one.label === action.label))
				.map((one) => one.label);
			return { picked: [...nextOptions, ...(group.customActive ? group.custom : [])] };
		}


		case 'clear':
			/* 未选择 = 删掉 `picked` 字段（空数组是「都不要」，两者不能混）。 */
			return { picked: undefined };

		case 'custom-toggle': {
			/*
			 * 自填行「选中」在架构里只能靠 `picked`（放自填文字，空文字放 `''`）。
			 *
			 * 单选：点一下就能选中（`picked: ['']`），再点取消回到未选择。
			 * 多选：**没输入文字时什么都不改** ——
			 *   否则 `picked: ['']` 会让 `pickedState` 从 `unset` 变 `picked`，
			 *   界面上看起来「从未选择变成选了 0 个」，用户明确说过这是错的。
			 *   多选只有真输入了文字才算选中。
			 */
			if (group.customActive) {
				return { picked: group.multiSelect ? withoutCustom : undefined };
			}
			if (text === '' && group.multiSelect) return {};
			return { picked: group.multiSelect ? [...withoutCustom, text] : [text] };
		}


		case 'custom-input': {
			/*
			 * 输入即选中：`custom` 存文字，`picked` 里放这段文字
			 * —— **屏幕上的「自填被选中」就长这样**（见 `askDraftViewOf()` 的裁定：
			 * 显示选中 = 会保存的选中，lead `2026-11-28`）。
			 *
			 * 空 / 全空白文字**不制造选中**：
			 *   · 原来就选中 ⇒ 保持选中（`picked: ['']`），否则打字打到一半全删、
			 *     圆圈会莫名熄灭；
			 *   · 原来没选中 ⇒ 只清 `custom`，`picked` 原样不动 —— 不能凭空写出一份
			 *     屏幕上从来没显示过的「选中」（比如把一段没选中的自填文字删空）。
			 */
			if (action.text.trim() === '') {
				const custom = action.text === '' ? [] : [action.text];
				if (!group.customActive) return { custom };
				return {
					custom,
					picked: group.multiSelect ? [...withoutCustom, ''] : [''],
				};
			}
			return {
				custom: [action.text],
				picked: group.multiSelect ? [...withoutCustom, action.text] : [action.text],
			};
		}

	}
}

/**
 * 自填框的**输入草稿** —— 「输入即选中」的全部状态（issue #61）。
 *
 * 它**不是**答案：答案仍然是 payload 的 `picked` / `custom`。草稿只活在组件的一次
 * 聚焦会话里，用来在「还没落库」的那段时间里画出选中态。
 */
export interface AskCustomDraft {
	/** 输入框当前文字（聚焦那一刻 = `custom[0]`）。 */
	readonly text: string;
	/**
	 * 这一轮输入里**有没有真的打过字**（发生过 input 事件，哪怕是删空）。
	 *
	 * ## 裁定（lead `2026-11-28`）：**显示选中 = 会保存的选中，没有例外**
	 *
	 * 用户 `2026-11-28`（issue #61）：「输入内容的时候没有自动立刻选择自填框」
	 * ⇒ 打了字就要**立刻**看到选中；
	 * 用户 `2026-11-21` 第 3 条：「点输入框不是选择（可能只是想刮取/看文字）」
	 * ⇒ 只聚焦不许改答案。
	 *
	 * 两句合起来只有一个自洽解：**屏幕上「自填被选中」必须等价于「失焦后会落库」**，
	 * 否则就是「看起来选了、其实没保存」的欺骗态。所以：
	 *
	 * | 会话 | 界面 | 失焦后 |
	 * |---|---|---|
	 * | 已落库的选中（`customActive`）| 显示（payload 本来就选着）| 不变 |
	 * | 打过字且**有文字**（`edited && text.trim() !== ''`）| 立刻显示选中 | 一次 `custom-input` 落库 |
	 * | 只聚焦 / 没打字 / 打的全是空白 | **不显示**（同组选项、未选择徽章原样）| 不写库 |
	 */
	readonly edited: boolean;
}

/**
 * 「自填框正在输入中的草稿」叠到组视图上 —— **输入即选中**。
 *
 * ## 为什么要这一层（issue #61）
 *
 * 用户 `2026-11-28`（截图 11）：在自填框里打了 `444`、光标还在框内，
 * 单选圆圈却是空的；**必须失焦才变选中**。
 *
 * 根因是数据流：选中态只能来自 payload（`customActive` ← `picked`），
 * 而 `picked` 只在失焦时随 `custom-input` 落库 ⇒ **打字期间界面没有「选中」可画**。
 *
 * 但「一次编辑一次 PATCH」的节奏不能破（见 `AskCustomRow` 的注释）。所以草稿
 * **不落库**，只在渲染时叠上去；叠加的判据与 `askCustomCommitOf()`／`askPatchOf()`
 * **严格互逆**（lead `2026-11-28`：显示选中 = 会保存的选中）：
 *
 * | 组 | 草稿 | 叠加结果（同一帧）|
 * |---|---|---|
 * | 任意 | 已落库的选中 / 没打过字 / 只有空白 | **原样返回**（不显示选中）|
 * | 单选 | 打过字且有文字 | 自填选中，**其它选项全部取消**，「未选择」熄灭 |
 * | 多选 | 打过字且有文字 | 自填选中，**已选选项保留**（共存，和 `custom-input` 一样）|
 *
 * ⚠ 这条「不显示」不是保守，是必须的：只聚焦不打字时 `askCustomCommitOf()` 返回
 *   `undefined`（不写库）。要是在这里显示选中，屏幕就会说一件失焦后不成立的事。
 *
 * @param group 当前组
 * @param draft 草稿；`undefined` = 没在输入（原样返回）
 * @returns 叠加后的组视图（不显示选中时**原样返回** `group`）
 */
export function askDraftViewOf(group: AskGroupView, draft: AskCustomDraft | undefined): AskGroupView {
	if (draft === undefined) return group;

	/* ① 已经落库的选中：payload 就选着，不需要叠加（草稿只是换文字）。 */
	if (group.customActive) return group;

	/* ② 没打过字（只聚焦）⇒ 失焦不写库 ⇒ 现在也不许显示选中。 */
	if (!draft.edited) return group;

	/* ③ 打过字但没有文字（空串 / 全空白）⇒ `custom-input` 不会把它变成选中。 */
	if (draft.text.trim() === '') return group;

	/** 草稿叠加后 `picked` 里的选项部分：单选全清，多选原样保留。 */
	const kept = group.multiSelect ? group.options.filter((one) => one.picked).map((one) => one.label) : [];

	return {
		...group,
		options: group.options.map((one) => ({ ...one, picked: group.multiSelect ? one.picked : false })),
		custom: [draft.text],
		customActive: true,
		pickedState: 'picked',
		/*
		 * 单选 = 只有自填这一条；
		 * 多选 = 已选选项 + 自填一条（自填本来就选中时它已经在 `picked` 里，
		 * 叠加只是换掉它的文字 ⇒ 计数不变，仍等于 `kept.length + 1`）。
		 */
		pickedCount: group.multiSelect ? kept.length + 1 : 1,
	};
}

/**
 * 自填框失焦时**该发什么动作**（`undefined` = 什么都不用发）。
 *
 * 只做一件事：把「打过字」的那一轮草稿按**既有节奏**落库 —— 一次失焦一次
 * `custom-input`（`custom` 与 `picked` 一起写，单选互斥 / 多选共存都在
 * `askPatchOf()` 里）。**没有新的写入口**。
 *
 * ⚠ 本函数与 `askDraftViewOf()` 是同一枚硬币的两面（lead `2026-11-28`）：
 *   界面上「自填显示为选中」⇔ 这里失焦后会把它落库为选中。改一个必须改另一个，
 *   `test/ask-action.test.ts` 的等价性用例会红。
 *
 * | 情形 | 动作 | 失焦后自填是选中吗 |
 * |---|---|---|
 * | 只聚焦，没打过字 | 不发 | 否（= 现状）|
 * | 打过字、文字确实变了 | `custom-input` | 有文字才选中（空 / 空白不算）|
 * | 打过字、文字又改回原值，且本来就选中 | 不发 | 是（payload 本来就选着）|
 * | 打过字、文字又改回原值，但界面显示过选中 | `custom-input` | 是 |
 * | 打过字、文字改回原值且界面没变化 | 不发 | 否 |
 *
 * @param group 当前组（真值，不是叠加后的视图）
 * @param draft 失焦那一刻的草稿；`undefined` = 没有输入会话
 */
export function askCustomCommitOf(
	group: AskGroupView,
	draft: AskCustomDraft | undefined,
): AskAction | undefined {
	if (draft === undefined) return undefined;

	/* 只聚焦过：没有「作答」这个意图（用户 2026-11-21 第 3 条）。 */
	if (!draft.edited) return undefined;

	const stored = group.custom[0] ?? '';

	/* ① 文字变了 ⇒ 一定得写：文字（可能被清空）和它带来的选中一起进 payload。 */
	if (draft.text !== stored) return { type: 'custom-input', text: draft.text };

	/* ② 文字没变 ⇒ 只补「界面上的选中还没落到 payload」这一种。 */
	if (group.customActive) return undefined;
	/* 界面没显示过选中（没文字 / 全空白）⇒ 没有「看到的选中」要补。 */
	if (askDraftViewOf(group, draft) === group) return undefined;

	return { type: 'custom-input', text: draft.text };
}

/**
 * 把一次作答动作**应用到 payload**，返回新 payload。
 *
 * ⚠ 这是父层（产品 / 预览）唯一该调的入口 ——
 * 单选互斥、自填文字进 `picked`、删 `picked` 字段这些规则已经在 `askPatchOf` 里，
 * 这里只负责把补丁 merge 回去。**不要再在外面手算一遍。**
 *
 * @param payload 原 payload（`{ $type:'ask', items:[…] }`）
 * @param groupIndex 改第几组（答案写在 `items[groupIndex]`）
 * @param action 用户的动作
 * @returns 新 payload；形状不对时原样返回
 */
export function applyAskAction(payload: unknown, groupIndex: number, action: AskAction): unknown {
	if (!isRecord(payload)) return payload;
	const rawItems = payload['items'];
	if (!Array.isArray(rawItems)) return payload;
	const rawItem = rawItems[groupIndex];
	if (!isRecord(rawItem)) return payload;

	const group = groupViewOf(rawItem);
	if (group === undefined) return payload;

	const patch = askPatchOf(group, action);
	const nextItem: Record<string, unknown> = { ...rawItem };
	for (const [key, value] of Object.entries(patch)) {
		/* `undefined` = 删掉这个字段（「未选择」必须删 `picked`，不是写空数组）。 */
		if (value === undefined) delete nextItem[key];
		else nextItem[key] = value;
	}

	const nextItems = [...rawItems];
	nextItems[groupIndex] = nextItem;
	return { ...payload, items: nextItems };
}

/**
 * 一次作答动作 → **整个新 payload**（只在形状合法时返回）。
 *
 * `applyAskAction()` 对脏数据会原样返回入参；这个包装把「没法作答」收窄成
 * `undefined`，让调用方（CardDetail 的接线）不用把 `unknown` 断言成对象。
 *
 * @param payload 原 payload
 * @param groupIndex 改第几组
 * @param action 用户的动作
 * @returns 新 payload；入参不是对象 / `items` 不对 / 那一组不是对象时 `undefined`
 */
export function askPayloadAfter(
	payload: unknown,
	groupIndex: number,
	action: AskAction,
): Readonly<Record<string, unknown>> | undefined {
	if (!isRecord(payload)) return undefined;
	const next = applyAskAction(payload, groupIndex, action);
	if (next === payload) return undefined;
	return isRecord(next) ? next : undefined;
}

export interface AskSectionView {
	readonly kind: 'ask';
	/** 问题组。**结构上 N 条**，模板现在都只用 1 条。 */
	readonly groups: readonly AskGroupView[];
	/** 一个组都没有（脏数据 / 空 items）。 */
	readonly empty: boolean;
}

/**
 * 把作答状态翻成界面文字（**冻结态**用）。
 *
 * 用户 2026-11-21：「不需要这个『单选』。单选在这个胶囊左边说过了。
 * 这里只要说『已选择』（单选时显示），或『已选 x』（多选时显示），
 * 或『未选择』（带边框暗示这个是结果）就行了」
 *
 * ⇒ 不再拼「单选」/「多选」前缀 —— 那已经在 header 里说过了。
 */
export function askStateLabelOf(group: AskGroupView): string {
	if (group.pickedState === 'unset' || group.pickedState === 'none') return '未选择';
	return group.multiSelect ? `已选 ${group.pickedCount}` : '已选择';
}

/**
 * 「未选择」动作的哨兵值（历史遗留：早期用 `onAnswer(sectionId, '')` 表示它）。
 *
 * ⚠ 现在清空走 `AskAction.clear`，这个常量只为兼容老调用方保留。
 */
export const NO_ANSWER = '';

/** 一个原始选项 → 渲染决定；脏数据跳过。 */
function optionViewOf(raw: unknown, picked: readonly string[]): AskOptionView | undefined {
	if (!isRecord(raw)) return undefined;
	const label = raw['label'];
	if (typeof label !== 'string' || label === '') return undefined;
	return {
		label,
		description: stringField(raw, 'description'),
		picked: picked.includes(label),
	};
}

/** `picked` → 只留字符串。 */
function pickedOf(raw: unknown): readonly string[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((one): one is string => typeof one === 'string');
}

/** 一个原始问题组 → 渲染决定；脏数据跳过（返回 `undefined`）。 */
function groupViewOf(raw: unknown): AskGroupView | undefined {
	if (!isRecord(raw)) return undefined;

	const picked = pickedOf(raw['picked']);
	/*
	 * 三态，只认数组：
	 *   不是数组（不存在 / 脏值）⇒ `unset` —— **不猜**「他都不要」；
	 *   `[]`                      ⇒ `none`  —— 看了但都不要；
	 *   非空                      ⇒ `picked`。
	 */
	const rawPicked = raw['picked'];
	let pickedState: AskPickState = 'unset';
	if (Array.isArray(rawPicked)) pickedState = rawPicked.length === 0 ? 'none' : 'picked';

	const rawOptions = raw['options'];
	const options: AskOptionView[] = [];
	if (Array.isArray(rawOptions)) {
		for (const one of rawOptions) {
			const view = optionViewOf(one, picked);
			if (view !== undefined) options.push(view);
		}
	}

	const rawCustom = raw['custom'];
	const custom = Array.isArray(rawCustom)
		? rawCustom.filter((one): one is string => typeof one === 'string')
		: [];

	const header = stringField(raw, 'header');
	const question = stringField(raw, 'question');
	const placeholder = stringField(raw, 'placeholder');

	return {
		header,
		question,
		multiSelect: raw['multi_select'] === true,
		options,
		pickedState,
		pickedCount: picked.length,
		custom,
		customActive: picked.some((one) => !options.some((option) => option.label === one)),
		placeholder,
		empty:
			header === '' && question === '' && options.length === 0 && custom.length === 0,
	};
}

/**
 * ask payload → 渲染决定。
 *
 * 形状不对的地方**跳过**而不是抛：`items` 不是数组 ⇒ 零个组（界面显示「这一章没有
 * 可显示的问题」）；某一组不是对象 ⇒ 跳过那一组。
 *
 * @param payload 任意 payload（通常是 `{ $type:'ask', items:[…] }`）
 */
export function askSectionOf(payload: unknown): AskSectionView {
	const groups: AskGroupView[] = [];
	if (isRecord(payload)) {
		const rawItems = payload['items'];
		if (Array.isArray(rawItems)) {
			for (const one of rawItems) {
				const view = groupViewOf(one);
				if (view !== undefined) groups.push(view);
			}
		}
	}
	return { kind: 'ask', groups, empty: groups.length === 0 };
}

/* ══════════════════════════════════════════════════════════
   三种形态的渲染决定
   ══════════════════════════════════════════════════════════ */

/** text 章节。 */
export interface TextSectionView {
	readonly kind: 'text';
	readonly value: string;
	readonly placeholder: string;
	readonly empty: boolean;
}

/** markdown 章节 —— **只把源码交出去**，解析与净化在 `renderers/Markdown.tsx`。 */
export interface MarkdownSectionView {
	readonly kind: 'markdown';
	/** 原样的 markdown 源码（不在这里解析，解析器不是本文件的事）。 */
	readonly source: string;
	readonly placeholder: string;
	readonly empty: boolean;
}

/** 未知 $type / 脏 payload —— 降级成「展开原始 JSON」，不白屏、不猜。 */
export interface UnknownSectionView {
	readonly kind: 'unknown';
	/** 给人看的一句话（含 `$type`）。 */
	readonly title: string;
	/** 原始 JSON（已截断）。 */
	readonly json: string;
}

/** 一个章节的渲染决定。 */
export type SectionView = TextSectionView | MarkdownSectionView | AskSectionView | UnknownSectionView;

/** JSON 预览最长字符数 —— 太长会把详情页撑爆。 */
const JSON_PREVIEW_LIMIT = 2000;

/**
 * payload → JSON 预览字符串。
 *
 * 循环引用 / BigInt 之类 `JSON.stringify` 会抛的脏数据 ⇒ 退回 `String(payload)`。
 * 两条路都**不抛**。
 */
export function jsonPreviewOf(payload: unknown): string {
	let json: string;
	try {
		json = JSON.stringify(payload, undefined, 2) ?? String(payload);
	} catch {
		try {
			json = String(payload);
		} catch {
			json = '[无法序列化的数据]';
		}
	}
	return json.length > JSON_PREVIEW_LIMIT ? `${json.slice(0, JSON_PREVIEW_LIMIT)}…` : json;
}

/**
 * payload → 渲染决定。
 *
 * 这是本文件的主入口：**任意 `unknown` 都有一个能画的结果**。
 *
 * @param payload 章节的 payload（可能来自未校验的模板默认值 / 脏数据）
 */
export function sectionViewOf(payload: unknown): SectionView {
	const kind = payloadKindOf(payload);

	if (kind === 'text') {
		const record = isRecord(payload) ? payload : undefined;
		const value = typeof payload === 'string' ? payload : extractText(payload);
		return {
			kind: 'text',
			value,
			placeholder: record === undefined ? '' : stringField(record, 'placeholder'),
			empty: value.trim() === '',
		};
	}

	if (kind === 'markdown') {
		const record = isRecord(payload) ? payload : {};
		const source = stringField(record, 'value');
		return {
			kind: 'markdown',
			source,
			placeholder: stringField(record, 'placeholder'),
			empty: source.trim() === '',
		};
	}

	if (kind === 'ask') return askSectionOf(payload);

	const type = payloadTypeOf(payload);
	return {
		kind: 'unknown',
		title: type === '' ? '无法识别的数据' : `未注册的动作「${type}」`,
		json: jsonPreviewOf(payload),
	};
}

/**
 * 章节名 —— **模板给的副本**（`CardSection.label`），不是容器词。
 *
 * 用户 `2026-11-15` 问「那个『正文』那两个字。存在那里的意义是什么。他起到了什么作用？」
 * ⇒ 没有作用，已删。这里**不编任何名字**：label 为空就返回空串，由组件决定
 *   「不画标题」，而不是画一个「正文」。
 *
 * @param section 卡上的章节（运行时可能是脏数据）
 */
export function sectionLabelOf(section: unknown): string {
	if (!isRecord(section)) return '';
	const label = section['label'];
	return typeof label === 'string' ? label : '';
}

/**
 * 空章节的占位文字。
 *
 * - 只读：`（空）` —— 不提示用户去点（只读时点不动）
 * - 可编辑：payload 的 `placeholder`（模板作者写的灰字，三态一致）；
 *   没写就退回 `（空）`
 *
 * @param view text / markdown 的渲染决定
 * @param readonlyFlag 是否只读
 */
export function emptyHintOf(
	view: TextSectionView | MarkdownSectionView,
	readonlyFlag: boolean,
): string {
	if (readonlyFlag) return '（空）';
	return view.placeholder !== '' ? view.placeholder : '（空）';
}

/**
 * 这一章点下去能不能进编辑。
 *
 * ⚠ 组件**不判「能不能编辑」**（那由父层按卡片状态决定，见任务描述第 4 条），
 *   这里只是把 `readonly` 这一个布尔翻成「有没有交互」—— 判决仍然在父层。
 *
 * @param readonlyFlag 父层给的只读标记
 * @param hasCallback 父层有没有接 `onEdit`
 */
export function canEditOf(readonlyFlag: boolean, hasCallback: boolean): boolean {
	return !readonlyFlag && hasCallback;
}
