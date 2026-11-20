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
			 * 输入即选中：`custom` 存文字，`picked` 里放这段文字。
			 * 清空文字时**仍然保持选中**（`picked: ['']`）—— 否则打字打到一半全删，
			 * 圆圈会莫名熄灭，和「点了就选中」不一致。
			 */
			const next = action.text === '' ? '' : action.text;
			return {
				custom: action.text === '' ? [] : [action.text],
				picked: group.multiSelect ? [...withoutCustom, next] : [next],
			};
		}

	}
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
