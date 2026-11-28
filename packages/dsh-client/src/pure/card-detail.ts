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
 * | **显示什么** | `head.status` / `head.meta` / `head.actions` / `sections` / `note` / `history` | 只 `map` |
 * | **按什么顺序** | 状态在最左；meta 四格；section 用卡的键插入顺序；history 最新在上 | 不排序 |
 * | **哪些常驻** | 备注是**字面量 `true`**；历史空才不显示，有就全画 | 不判断 |
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
 * ## ⚠ 用户否定的五件事（本文件把它们变成类型/字段）
 *
 * 1. **标题独占一行**（`2026-11-15`）—— `DetailHeadView.title` 是**单个字符串字段**，
 *    和 `meta` **分在两个字段里**。
 *    组件想「把标题塞进 meta 行」得自己拼 DOM，而 CDP 会按几何位置抓它。
 * 2. **不要「正文」这种容器标签**（`2026-11-15`）—— 本文件里没有任何 "正文" 字符串，
 *    章节直接平铺（旧版 `sectionList()` 也是平铺的，没有外层标题）。
 * 3. **备注常驻**（`2026-11-15`）—— `DetailNoteView.visible` 的类型是 `true` 而不是 `boolean`。
 *    这不是修辞：写 `visible: false` 编译不过。
 *    （旧产品 MVP `src/views/CardDetail.tsx` 是 `card.note !== '' ? … : null`，
 *      正是「不常驻」；旧版 taskboard2 反而是常驻的。**两版各错一半。**）
 * 4. **状态放最左**（`2026-11-18`）—— `head.status` 是**独立字段**，不在 `meta` 数组里
 *    ⇒ 组件只有一个地方能画它，label 再长也挤不走（见 `DetailStatusView`）。
 * 5. **历史不折叠**（`2026-11-18`）—— `DetailHistoryView` 里**没有**
 *    `collapsible` / `collapsed` 字段。删字段不是省略，是判决（见 `historyTableOf`）。
 *
 * ## 历史：**不折叠**
 *
 * 用户 `2026-11-18`：
 * > 「历史不需要折叠。没有折叠的含义。他是一个竖直显示。但是历史自己就是最后了。
 * >  他的折叠并不影响看他后面的内容。他没有更后面了。」
 *
 * 折行的意义是「省空间给后面的内容让位」；历史在最后面，后面没有了
 * ⇒ 折它不换回任何东西。
 */

import { extractText } from '../pure.ts';
import type { Card, CardSection } from '../types.ts';
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
 * 状态 —— **独立字段**，不在 `meta` 数组里。
 *
 * ## 用户 `2026-11-18`（这次改版的起因）
 *
 * > 「状态需要放在最左边。可交互的东西被 label 顺位放在右边是不合理的。
 * >  如果 label 太长，那么状态按钮的位置甚至会变化。所以他至少放在 label 的左边。
 * >  但我希望他放在编号的左边。」
 *
 * ## 为什么做成独立字段而不是 `meta` 的一个成员
 *
 * 和 `title` 同一手法：**结构保证 > CSS 保证**。
 *
 * 状态留在 `meta` 数组里时，它和 label 是同一行 flex 的兄弟 —— 位置取决于
 * 前面几个 label 有多宽。做成独立字段后，组件**只有**一个地方能画它
 * （那个固定宽度的首列），它物理上不可能被 label 挤走。
 * CDP 会量「状态 left < 编号 left」和「超长 label 下状态 left 不变」。
 *
 * ⚠ 旧版是可点的状态胶囊，v3 的菜单归 C4 `StatusMenu`（另一个人做的），
 *   所以这里只描述「画什么」，不含「点了干什么」。
 */
export interface DetailStatusView {
	/** A2A 状态全名（`TASK_STATE_*`），`StatusButton` 用它判颜色。 */
	readonly status: string;
	/** 中文名。 */
	readonly text: string;
}

/**
 * meta 行的四格 —— **不含状态**（状态是 `DetailHeadView.status`）。
 *
 * 顺序**固定**为：编号 → 类别 → 领域 → 模板
 * （旧版 `header.js:83-89` 的 `status-line`；用户 `2026-11-15` 只要求
 * 「标题独占一行」，没要求动这一行的顺序）。
 *
 * 做成可辨识联合而不是 `{kind, text}` 两字段：编号/类别需要**色系 key**，
 * 模板需要 `title`。用一个宽接口就得把所有字段都设成可选，
 * `exactOptionalPropertyTypes` 下每个使用点都要窄化。
 */
export type DetailMetaItem =
	/** 编号（等宽、分类色）。 */
	| { readonly kind: 'id'; readonly text: string; readonly tone: KnownKind }
	/** 分类徽章（中文名 + 分类底色）。 */
	| { readonly kind: 'kind'; readonly text: string; readonly tone: KnownKind }
	/** 领域徽章。 */
	| { readonly kind: 'domain'; readonly text: string }
	/** 模板徽章（`title` 里带完整说明）。 */
	| { readonly kind: 'template'; readonly text: string; readonly title: string };

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

/** 头部（标题行 + 状态/编号/meta 行 + 动作行 + 墓碑横幅）。 */
export interface DetailHeadView {
	/**
	 * 标题。
	 *
	 * ⚠ 这是**标题独占一行**的结构性保证：它是个独立字段，
	 *   和 `meta` 是两个数组，组件没有「把它拼进 meta」的位置可放。
	 */
	readonly title: string;
	/**
	 * 状态 —— **独立字段**，组件只在固定宽度的首列里画它。
	 *
	 * ⚠ 不在 `meta` 数组里，见 `DetailStatusView` 的注释（用户 `2026-11-18`）。
	 */
	readonly status: DetailStatusView;
	/** meta 四格（编号 / 类别 / 领域 / 模板），**不含状态**。 */
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
 * ## `payload` 原样透传 —— 内容怎么画归 `Section`
 *
 * 卡上的形状是 `CardSection = { label, payload }`（`src/types.ts:44`），
 * `payload` 是 action 给的**不透明结构**（`{ $type:'text', value }` 一类）。
 * 2026-11-20 起 `CardDetail` 用定稿 `Section` 渲染章节，它按 payload 的 `$type`
 * 自己分派 text / markdown / ask / 未知降级（解析只有 `pure/section.ts` 一处）。
 * ⇒ 这里把 **`payload` 原样透传**（`sections[i].payload === card.sections[id].payload`，
 * 单测用 `assert.strictEqual` 钉住）；装箱成 `SectionProps` 的纯适配在
 * `pure/section-adapter.ts`。
 *
 * `text` / `empty` 是 `SectionStub` 时代的纯文本兜底（`extractText()`，对 v3 的 ask
 * 返回空串）—— 组件已**不再读**它们，保留是因为单测钉着、给纯文本兜底的调用方用。
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
	/** 从 payload 抽出的人话（纯文本兜底；组件已改用 `Section`，不再读它）。 */
	readonly text: string;
	/** 内容为空（纯文本口径；组件已改用 `Section`，不再读它）。 */
	readonly empty: boolean;
	/** 原样透传给 `Section`（经 `sectionInputOf()`）。 */
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
	/*
	 * ⚠ 这里**没有** `collapsible` / `collapsed` —— 用户 `2026-11-18` 把折叠否掉了：
	 *
	 *   > 「历史不需要折叠。没有折叠的含义。他是一个竖直显示。但是历史自己就是最后了。
	 *   >  他的折叠并不影响看他后面的内容。他没有更后面了。」
	 *
	 * 折行的意义是「省空间，给后面的内容让位」。历史在**最后面**，后面没有了
	 * ⇒ 折它不换回任何东西，只多一次点击。
	 *
	 * ⇒ 这两个字段是**故意删掉的**，不是忘了写。谁想加回来，先看上面这句话。
	 */
	readonly count: number;
	/** 表头文案，带计数（旧版 `历史（N）`）。 */
	readonly label: string;
	/** 最新在前的条目，**全部**都要画（没有「只画前 N 条」）。 */
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
		 * 状态**独立**于 meta —— 用户 `2026-11-18`：
		 * 「我希望他放在编号的左边」+ 「如果 label 太长，那么状态按钮的位置甚至会变化」。
		 * 拆成独立字段后，组件只能把它画在固定宽度的首列里。
		 */
		status: { status: card.status, text: stateLabel(card.status) },
		/*
		 * 四格顺序 = 旧版 `header.js:83-89` 去掉状态那一格。
		 * 用户只改了「标题独占一行」和「状态挪到最左」，这几格的相对顺序没动。
		 */
		meta: [
			{ kind: 'id', text: card.id, tone },
			{ kind: 'kind', text: labels.kindLabel, tone },
			{ kind: 'domain', text: card.template.domain },
			{ kind: 'template', text: labels.templateLabel, title: `模板：${labels.templateLabel}` },
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
 * ## 不折叠（用户 `2026-11-18` 否掉了这个功能）
 *
 * > 「历史不需要折叠。没有折叠的含义。他是一个竖直显示。但是历史自己就是最后了。
 * >  他的折叠并不影响看他后面的内容。他没有更后面了。」
 *
 * 折行的意义是「省空间，给后面的内容让位」。历史在**最后面**，后面没有了
 * ⇒ 折它不换回任何东西。所以这里**没有** `collapsible` / `collapsed` 字段，
 * 组件也没有折叠按钮。
 *
 * ⚠ 上一版（`2026-11-18` 之前）有「≥2 条初始折叠」，那是成员自己的判断。
 *   用户给了明确的判据把它否掉了 —— **判据是「后面还有没有内容」，不是条数**。
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

	return {
		visible: count > 0,
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
