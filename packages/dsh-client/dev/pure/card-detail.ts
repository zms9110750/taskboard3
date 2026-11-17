/**
 * 卡片详情面板（C7）的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * ## 这张表回答三个问题
 *
 * 任务描述里那句「核心难点：语义在『显示什么、按什么顺序、哪些常驻哪些折叠』」
 * 拆开就是：
 *
 * | 问题 | 这里怎么答 | 组件怎么用 |
 * |---|---|---|
 * | **显示什么** | `head.meta` / `head.actions` / `sections` / `note` / `history` 五个数组 | 只 `map` |
 * | **按什么顺序** | meta 固定五格；section 用卡的键插入顺序；history 最新在上 | 不排序 |
 * | **哪些常驻 / 折叠** | `note.visible` 是**字面量 `true`**；`history.collapsed` 是**初始**折叠态 | 不判断 |
 *
 * ⇒ 组件里没有 `if (card.note !== '')`、没有 `if (history.length)`、没有 `.sort()`。
 *   这些一旦散进 JSX，改一处就漏一处，而编译器不会告诉你漏了。
 *
 * ## 语义来源
 *
 * 旧版 `taskboard2/packages/browser/public/views/card-detail/`：
 * `index.js`（170）+ `header.js`（123）+ `history-block.js`（110）+ `relations-block.js`（147）。
 * 下面每条规则都标了对应旧文件的行区间。
 *
 * ## ⚠ 用户 `2026-11-15` 否定的三件事（本文件把它们变成类型/常量）
 *
 * 1. **标题独占一行** —— `DetailHeadView.title` 是**单个字符串字段**，
 *    和 `meta`（编号/类别/领域/模板/状态）**分在两个数组里**。
 *    组件想「把标题塞进 meta 行」得自己拼 DOM，而 CDP 会按几何位置抓它。
 * 2. **不要「正文」这种容器标签** —— 本文件里没有任何 "正文" 字符串，
 *    章节直接平铺（旧版 `sectionList()` 也是平铺的，没有外层标题）。
 * 3. **备注常驻** —— `DetailNoteView.visible` 的类型是 `true` 而不是 `boolean`。
 *    这不是修辞：写 `visible: false` 编译不过。
 *    （旧产品 MVP `src/views/CardDetail.tsx` 是 `card.note !== '' ? … : null`，
 *      正是「不常驻」；旧版 taskboard2 反而是常驻的。**两版各错一半。**）
 *
 * ## 历史：**折叠**，不常驻
 *
 * 用户 `2026-11-15` 只说「历史可以折叠」；我（成员）判「应该折叠」，理由见
 * `historyTableOf()`。折叠的是**初始态**，不是能力 —— 组件仍能展开。
 */

import { extractText } from '../../src/pure.ts';
import type { Card, CardSection } from '../../src/types.ts';
import { kindTone, stateLabel, fmtDateTime, type KnownKind } from './card-view.ts';

/* ══════════════════════════════════════════════════════════
   调用方给的两个名字
   ══════════════════════════════════════════════════════════ */

/**
 * 组件自己查不到的两个中文名 —— 由调用方从模板清单 / 词表传进来。
 *
 * ⚠ 本文件**不硬编码**分类中文名（`goal: '目标'` 那种）。理由见
 *   `dev/pure/card-view.ts` 文件头：v3 的中文名来自模板清单，
 *   UI 再抄一份就是第二份真值。
 */
export interface DetailLabels {
	/** 分类中文名（如「设计」）。 */
	readonly kindLabel: string;
	/** 模板显示名（`displayName`，找不到时调用方传 ref）。 */
	readonly templateLabel: string;
}

/* ══════════════════════════════════════════════════════════
   ① 标题行 / meta 行 / 动作行
   ══════════════════════════════════════════════════════════ */

/**
 * meta 行的五格。
 *
 * 顺序**固定**为：编号 → 类别 → 领域 → 模板 → 状态
 * （旧版 `header.js:83-89` 的 `status-line`；用户 `2026-11-15` 只要求
 * 「标题独占一行」，没要求动这一行的顺序）。
 *
 * 做成可辨识联合而不是 `{kind, text}` 两字段：状态的圆点需要**原始 state id**
 * （颜色由 `stateTone()` 判），编号/类别需要**色系 key**。用一个宽接口就得
 * 把所有字段都设成可选，`exactOptionalPropertyTypes` 下每个使用点都要窄化。
 */
export type DetailMetaItem =
	/** 编号（等宽、分类色）。 */
	| { readonly kind: 'id'; readonly text: string; readonly tone: KnownKind }
	/** 分类徽章（中文名 + 分类底色）。 */
	| { readonly kind: 'kind'; readonly text: string; readonly tone: KnownKind }
	/** 领域徽章。 */
	| { readonly kind: 'domain'; readonly text: string }
	/** 模板徽章（`title` 里带完整说明）。 */
	| { readonly kind: 'template'; readonly text: string; readonly title: string }
	/** 状态：圆点 + 中文名（旧版是**可点**的状态胶囊，v3 的菜单归 C4）。 */
	| { readonly kind: 'status'; readonly status: string; readonly text: string };

/** 动作行里按钮的种类 —— 组件的「机械映射」就映射这两个值。 */
export type DetailActionKind = 'relations' | 'derive';

/**
 * 动作行上的一个按钮。
 *
 * `emphasis` 是用户 `2026-11-15` 的第 2 条要求：
 * > 「关系 N 那个按钮要显眼」（旧版藏在标题下方的 `▸ 关系 N` 小按钮里，太隐蔽）
 *
 * ⇒ 关系按钮 **`'primary'`**（accent 实底），派生子任务 `'normal'`。
 *   这条规则在 pure 里，组件不判「哪个更重要」。
 */
export interface DetailAction {
	readonly kind: DetailActionKind;
	readonly label: string;
	/** 计数徽标；`null` = 这个按钮不显示数字。 */
	readonly badge: number | null;
	readonly emphasis: 'primary' | 'normal';
	readonly disabled: boolean;
	readonly title: string;
}

/** 头部（标题行 + meta 行 + 动作行 + 墓碑横幅）。 */
export interface DetailHeadView {
	/**
	 * 标题。
	 *
	 * ⚠ 这是**标题独占一行**的结构性保证：它是个独立字段，
	 *   和 `meta` 是两个数组，组件没有「把它拼进 meta」的位置可放。
	 */
	readonly title: string;
	readonly meta: readonly DetailMetaItem[];
	readonly actions: readonly DetailAction[];
	/** 墓碑横幅文案；`null` = 没删除，不显示。 */
	readonly banner: string | null;
}

/* ══════════════════════════════════════════════════════════
   ② 章节
   ══════════════════════════════════════════════════════════ */

/**
 * 一个章节的渲染决定。
 *
 * ## payload 形状假设（⚠ 等 C6 `Section` 合并后可能变）
 *
 * 卡上的形状是 `CardSection = { label, payload }`（`src/types.ts:44`），
 * `payload` 是 action 给的**不透明结构**（`{ $type:'text', value }` 一类）。
 * 我假设 C6 的 `Section` 接 `{ label, payload }` 自己解释类型，
 * 所以这里把 **`payload` 原样透传**（`sections[i].payload === card.sections[id].payload`，
 * 单测用 `assert.strictEqual` 钉住），`text` 只是 C6 合并前的**纯文本兜底**
 * （复用产品 `src/pure.ts` 的 `extractText`，它已单测过）。
 *
 * ## 顺序 = 卡的键插入顺序，**不排**
 *
 * 旧版 `sectionList()`（`sections.js`）就是 `Object.entries(card.sections)`。
 * 章节顺序是**模板作者写的顺序**（core 建卡时按模板顺序写入）；
 * 按 label 排会把它变成拼音序 —— 模板作者的顺序是语义，不是巧合。
 */
export interface DetailSection {
	/** `card.sections` 的键（模板里的 sectionId）。 */
	readonly id: string;
	/** 章节名**副本**（模板卸载后仍能显示）。 */
	readonly label: string;
	/** 从 payload 抽出的人话（C6 合并前的兜底）。 */
	readonly text: string;
	/** 内容为空 ⇒ 组件显示占位（旧版是留一个空 div，用户看到一块空白）。 */
	readonly empty: boolean;
	/** 原样透传给 C6 `Section`。 */
	readonly payload: unknown;
}

/* ══════════════════════════════════════════════════════════
   ③ 备注（常驻）
   ══════════════════════════════════════════════════════════ */

/** 备注区块的渲染决定。 */
export interface DetailNoteView {
	/**
	 * 是否显示。
	 *
	 * ⚠ **字面量 `true`**，不是 `boolean` —— 用户 `2026-11-15`：
	 * > 「备注常驻」（不要折叠成 `+ 备注`）
	 *
	 * ⇒ 写 `visible: false` 编译不过。这是把用户要求变成**类型级**约束，
	 *   和 `space-bar.ts` 里 `ChipIntent = 'view'` 同一个手法。
	 */
	readonly visible: true;
	readonly label: string;
	readonly placeholder: string;
	/** 初始文本（组件用 `defaultValue`，受控与否见 `DetailNote.tsx`）。 */
	readonly value: string;
	/** 可编辑？墓碑只读（旧版 `index.js:69` 的 `disabled`）。 */
	readonly editable: boolean;
}

/* ══════════════════════════════════════════════════════════
   ④ 历史
   ══════════════════════════════════════════════════════════ */

/** 历史事件的人话 + 时间。 */
export interface DetailHistoryItem {
	/** React key（`at` + 原始下标，同毫秒也唯一）。 */
	readonly key: string;
	/** 机器标识（原样留着，方便排查）。 */
	readonly action: string;
	/** 人话。 */
	readonly text: string;
	/** 时间戳（毫秒）。 */
	readonly at: number;
	/** 已格式化的 `MM-DD HH:mm`。 */
	readonly time: string;
	/** 谁触发的（`unknown` = 条目没带 `actor`，老数据/坏数据）。 */
	readonly actor: 'ai' | 'user' | 'unknown';
}

/** 历史区块的渲染决定。 */
export interface DetailHistoryView {
	/**
	 * 是否显示。
	 *
	 * ⚠ **空历史不显示**（旧版 `history-block.js:96-97`：`length === 0` 返回 `null`）。
	 *   和备注相反：备注是**用户要写的东西**（空着也要给输入框），
	 *   历史是**追加的记录**（一条没有就是没有，画个空框只会让人以为加载失败）。
	 */
	readonly visible: boolean;
	/** 能不能折起来。`false` = 只有一条，折它没意义（见 `historyTableOf`）。 */
	readonly collapsible: boolean;
	/**
	 * **初始**折叠态。`true` = 一开始收着，用户点一下展开。
	 *
	 * ⚠ 这是语义（「进来时该不该占一屏」），不是 UI 状态 ——
	 *   真正的开合由组件 `useState` 持有，初值取这里。
	 */
	readonly collapsed: boolean;
	readonly count: number;
	/** 表头文案，带计数（旧版 `历史（N）`）。 */
	readonly label: string;
	/** 最新在前的条目。 */
	readonly items: readonly DetailHistoryItem[];
}

/* ══════════════════════════════════════════════════════════
   整张表
   ══════════════════════════════════════════════════════════ */

/** 详情面板的全部渲染决定 —— 组件只 `map` 这一张表。 */
export interface CardDetailTable {
	readonly head: DetailHeadView;
	readonly sections: readonly DetailSection[];
	readonly note: DetailNoteView;
	readonly history: DetailHistoryView;
}

/* ══════════════════════════════════════════════════════════
   实现
   ══════════════════════════════════════════════════════════ */

/** 备注的固定文案（旧版 `index.js:66` 的 label / placeholder，一字未改）。 */
const NOTE_LABEL = '备注 / 搁置理由（随时写）';
const NOTE_PLACEHOLDER = '随时写，不用管格式';

/**
 * 历史折叠的**最小条数**。
 *
 * 1 条折起来只藏一行，省不了空间却多一次点击 ⇒ 1 条直接展开、不给折叠按钮；
 * 2 条起才有「详情页被历史占满一屏」的问题（用户 `2026-11-15` 的原话是
 * 「旧版常驻占满一屏」）。
 */
export const HISTORY_COLLAPSE_MIN = 2;

/**
 * 建整张表。
 *
 * @param card 卡
 * @param labels 调用方给的两个中文名
 */
export function detailTableOf(card: Card, labels: DetailLabels): CardDetailTable {
	return {
		head: headOf(card, labels),
		sections: sectionsOf(card.sections),
		note: noteOf(card),
		history: historyTableOf(card.history),
	};
}

/**
 * 头部：标题 / meta 五格 / 动作行 / 墓碑横幅。
 *
 * @param card 卡
 * @param labels 中文名
 */
export function headOf(card: Card, labels: DetailLabels): DetailHeadView {
	const tone = kindTone(card.template.kind);

	return {
		title: card.title,
		/*
		 * 五格顺序 = 旧版 `header.js:83-89`。用户只改了「标题独占一行」，
		 * 这一行本身没动 ⇒ 顺序照旧。
		 */
		meta: [
			{ kind: 'id', text: card.id, tone },
			{ kind: 'kind', text: labels.kindLabel, tone },
			{ kind: 'domain', text: card.template.domain },
			{ kind: 'template', text: labels.templateLabel, title: `模板：${labels.templateLabel}` },
			{ kind: 'status', status: card.status, text: stateLabel(card.status) },
		],
		actions: actionsOf(card),
		/*
		 * 墓碑横幅（旧版 `header.js:100-105`）。旧文案写死了「它的状态是草稿」——
		 * v3 的墓碑是不是草稿由 core 判，UI 不替它断言，所以删掉那半句。
		 */
		banner: card.deleted
			? '这张卡已删除（墓碑）：只能查看，不能改状态、不能编辑备注、不能添加关系。'
			: null,
	};
}

/**
 * 动作行：**关系**（显眼，带计数）+ **派生子任务**。
 *
 * ## 关系计数：只数卡上的字段
 *
 * 旧版 `relationsSummary()` 要**全量卡列表**才能把草稿从关系里剔掉。
 * C7 的参数只有一张卡 ⇒ 这里只数 `card.relations`：
 * 父任务算 1 条，`links` 每条算 1 条。**「草稿不算关系对象」的过滤不在这一层**
 * —— 那是 V3 拿到全量卡之后的事。口径写在这里，免得以后有人以为差了一个数。
 *
 * ## 0 条也显示
 *
 * 用户要的是「显眼」，不是「有才显示」。0 条时按钮**仍然在**，
 * `badge: 0`，`title` 说明「点一下添加」—— 否则用户不知道这里能加关系。
 *
 * @param card 卡
 */
export function actionsOf(card: Card): readonly DetailAction[] {
	const relations = relationCountOf(card);

	return [
		{
			kind: 'relations',
			label: '关系',
			badge: relations,
			emphasis: 'primary',
			disabled: card.deleted,
			title:
				relations === 0
					? '这张卡还没有任何关系（点一下添加）'
					: `查看 / 添加关系（已有 ${relations} 条）`,
		},
		{
			kind: 'derive',
			label: '+ 派生子任务',
			badge: null,
			emphasis: 'normal',
			disabled: card.deleted,
			title: '新建一张卡，并把这张卡预填为父任务',
		},
	];
}

/** 卡上的关系条数（父任务 1 + `links` 条数）。 */
export function relationCountOf(card: Card): number {
	return (card.relations.parent === null ? 0 : 1) + card.relations.links.length;
}

/**
 * 章节列表 —— **保持卡的键插入顺序**，不排序、不隐藏空章节。
 *
 * 空章节仍然出现：章节名是**模板结构的一部分**，隐藏它用户会以为模板没写这一节。
 * 内容空由组件显示占位（`empty: true`）。
 *
 * @param sections 卡上的章节表
 */
export function sectionsOf(
	sections: Readonly<Record<string, CardSection>>,
): readonly DetailSection[] {
	return Object.entries(sections).map(([id, section]) => {
		const text = extractText(section.payload);
		return {
			id,
			label: section.label,
			text,
			/* 只有空白字符也算空 —— 否则会显示一个「看起来什么都没有」的框。 */
			empty: text.trim() === '',
			payload: section.payload,
		};
	});
}

/**
 * 备注 —— 恒常驻。
 *
 * `visible: true` 是字面量类型（见 `DetailNoteView`）。这里没有任何分支
 * 会把它变成 `false`：**备注是否常驻不取决于 note 是否为空、卡是否删除**
 * （删除的卡也显示备注 —— 下面 `editable` 才是折叠/只读的分界）。
 *
 * @param card 卡
 */
export function noteOf(card: Card): DetailNoteView {
	return {
		visible: true,
		label: NOTE_LABEL,
		placeholder: NOTE_PLACEHOLDER,
		value: card.note,
		editable: !card.deleted,
	};
}

/**
 * 历史表。
 *
 * ## 折叠规则（我判的，用户只说「可以折叠」）
 *
 * | 条数 | visible | collapsible | collapsed（初始）|
 * |---|---|---|---|
 * | 0 | `false` | `false` | `false` |
 * | 1 | `true` | `false` | `false` |
 * | ≥2 | `true` | `true` | `true` |
 *
 * **理由**：详情页一屏能放的东西有限，历史是**只读记录**（用户极少反复看），
 * 而章节/备注是要读要写的。旧版让它常驻、列表展开，用户 `2026-11-15` 的原话是
 * 「占满一屏」⇒ 默认收起。但只藏一条又变成「多点一次看一行」，
 * 所以 1 条时直接展开、不给折梅按钮。
 *
 * ## 排序：最新在上，**同毫秒保持原顺序**
 *
 * 旧版 `history-block.js:98-99` 是 `[...history].sort((l, r) => r.at - l.at)`，
 * 物流轨迹的常见读法。JS 的 `Array#sort` 是**稳定**的 ⇒ 同毫秒的两条
 * 保持卡的写入顺序（也就是真实发生顺序）。
 * 单测钉住这一点 —— 本仓踩过「同毫秒时间戳比较」的 flake，这类断言不能靠「应该」。
 *
 * @param history 卡的历史（可能是脏数据：缺 `at`、action 不认识）
 */
export function historyTableOf(
	history: readonly HistoryEntryLike[],
): DetailHistoryView {
	const count = history.length;

	/* 先按时间倒排，下标用于 key 与同毫秒稳定。 */
	const ordered = history
		.map((entry, index) => ({ entry, index }))
		.sort((left, right) => {
			const delta = atOf(right.entry) - atOf(left.entry);
			return delta === 0 ? left.index - right.index : delta;
		});

	const items = ordered.map(({ entry, index }) => {
		const at = atOf(entry);
		const actor = actorOf(entry);

		return {
			key: `${at}-${index}`,
			action: entry.action,
			text: describe(entry, actor),
			at,
			time: fmtDateTime(at),
			actor,
		};
	});

	/*
	 * 1 条直接展开：`collapsed` 只在 ≥2 条时才为 `true`，
	 * 而 `collapsible` 与它同步 —— 不给折叠按钮却把列表收着是自相矛盾的。
	 * 空历史两个都 `false`（`visible: false` 时它们无意义，但不留「收着一个看不见的东西」）。
	 */
	const expandable = count >= HISTORY_COLLAPSE_MIN;

	return {
		visible: count > 0,
		collapsible: expandable,
		collapsed: expandable,
		count,
		label: `历史（${count}）`,
		items,
	};
}

/* ══════════════════════════════════════════════════════════
   历史条目 → 人话
   ══════════════════════════════════════════════════════════ */

/**
 * 本文件认识的历史条目形状。
 *
 * ⚠ `src/types.ts` 的 `HistoryEntry` **没有 `actor` 字段**（那一版是 v3 早期写的），
 *   而 core 的 `HistoryEntry`（`packages/core/src/card.ts:92`）**有**
 *   —— 这是客户端「结构子集」类型的正常缺口，不是 bug：多给的字段运行时就在，
 *   只是类型没声明。所以这里从**宽**读 `unknown`，运行时再窄化。
 *   （不去改 `src/types.ts`：那不是本组件的写作用域。）
 */
export interface HistoryEntryLike {
	readonly at: number;
	readonly action: string;
	readonly actor?: unknown;
	readonly detail?: unknown;
}

/** 触发者（v3 是条目**顶层**的 `actor` 字段，不是旧的 `detail.principal`）。 */
export function actorOf(entry: HistoryEntryLike): 'ai' | 'user' | 'unknown' {
	if (entry.actor === 'ai') return 'ai';
	if (entry.actor === 'user') return 'user';
	return 'unknown';
}

/** 触发者 → 人称。`unknown`（老数据）说「系统」，不假装是用户。 */
function whoOf(actor: 'ai' | 'user' | 'unknown'): string {
	if (actor === 'ai') return 'AI';
	if (actor === 'user') return '用户';
	return '系统';
}

/** 安全取 `at`：脏数据（NaN / 非数字）当 0，不抛异常、不编当前时间。 */
function atOf(entry: HistoryEntryLike): number {
	const at: unknown = entry.at;
	return typeof at === 'number' && Number.isFinite(at) ? at : 0;
}

/** `detail` 当对象读；不是对象就是空对象（不抛）。 */
function detailOf(entry: HistoryEntryLike): Record<string, unknown> {
	const detail: unknown = entry.detail;
	if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) return {};
	return detail as Record<string, unknown>;
}

/** `detail` 里的状态 id → 中文名（不认识就原样，旧版 `labelOf`）。 */
function labelOf(id: unknown): string {
	if (typeof id !== 'string' || id === '') return '—';
	return stateLabel(id);
}

/**
 * 一条历史 → 人话。
 *
 * 映射表来自旧版 `history-block.js:43-83` 的 `describe()`，**只改了一处**：
 * 作者从 `detail.principal / detail.origin` 推断改成读 v3 的 `entry.actor`
 * （core `2026-11-13` 把它显式记成字段了，见 `packages/core/src/card.ts:73-90`
 * 的「为什么不能从 action 反推」）。
 *
 * ⚠ 不认识的 action **原样显示**（旧版 `default: return entry.action`）。
 *   宁可让界面出现一个英文标识，也不编一句可能是错的中文。
 *
 * @param entry 历史条目
 * @param actor 已判决的触发者
 */
export function describe(entry: HistoryEntryLike, actor: 'ai' | 'user' | 'unknown'): string {
	const detail = detailOf(entry);
	const who = whoOf(actor);

	switch (entry.action) {
		case 'create': {
			/* 派生出来的卡：作者是派生者，但「派生出这张卡」才是用户要读的信息。 */
			if (detail['origin'] === 'derive') return '派生出这张卡';
			return `${who} 创建了这张卡`;
		}
		case 'update':
			return `${who} 修改了这张卡`;
		case 'delete':
			return `${who} 删除了这张卡（墓碑）`;
		case 'transition':
			return `${who} 把状态从「${labelOf(detail['from'])}」改成「${labelOf(detail['to'])}」`;
		case 'adopt':
			return `${who} 采纳了这张卡`;
		case 'claim':
			return `${who} 领取了这张卡`;
		case 'release':
			return `${who} 释放了这张卡`;
		case 'force-release':
			return '强制释放了这张卡';
		case 'fork': {
			const childId: unknown = detail['childId'];
			return typeof childId === 'string' && childId !== ''
				? `派生子任务 ${childId}`
				: '派生子任务';
		}
		case 'supersede': {
			const target: unknown = detail['superseded'];
			return typeof target === 'string' && target !== ''
				? `${who} 用这张卡取代了 ${target}`
				: `${who} 用这张卡取代了另一张卡`;
		}
		case 'recompute':
			return `系统按子任务重算：状态从「${labelOf(detail['from'])}」变成「${labelOf(detail['to'])}」`;
		default:
			return entry.action;
	}
}
