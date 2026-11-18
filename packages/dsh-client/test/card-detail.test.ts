/**
 * `pure/card-detail.ts` 的测试 —— 纯函数，零 DOM、零 React。
 *
 * 分组就是任务描述那张表：**显示什么 / 按什么顺序 / 哪些常驻**。
 * 用户否定的五件事各有专门断言，且都不是「读代码看出来」的，而是**表里读出来**的：
 *
 * | 用户 | 要求 | 钉住的断言 |
 * |---|---|---|
 * | `2026-11-15` | 标题独占一行 | `head.title` 是独立字段、不在 meta 里 |
 * | `2026-11-15` | 不要「正文」容器标签 | 全表文本不含「正文」 |
 * | `2026-11-15` | 备注常驻 | `note.visible` 是字面量 `true` |
 * | `2026-11-18` | 状态放最左（编号左边）| `head.status` 是独立字段、不在 meta 里 |
 * | `2026-11-18` | 历史不折叠 | 视图里**没有** `collapsible` / `collapsed` 字段 |
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	actionsOf,
	detailTableOf,
	headOf,
	historyTableOf,
	noteOf,
	relationCountOf,
	sectionsOf,
	type HistoryEntryLike,
} from '../src/pure/card-detail.ts';
import type { Card } from '../src/types.ts';

/* ── 夹具 ── */

const S = {
	draft: 'TASK_STATE_UNSPECIFIED',
	submitted: 'TASK_STATE_SUBMITTED',
	working: 'TASK_STATE_WORKING',
	completed: 'TASK_STATE_COMPLETED',
} as const;

const LABELS = { kindLabel: '设计', templateLabel: '功能设计' } as const;

/** 建一张卡；`over` 覆盖字段。 */
function card(over: Partial<Card> = {}): Card {
	return {
		id: 'DE-03',
		title: '把详情面板重做',
		status: S.working,
		template: { ref: 'design.feature', kind: 'design', domain: '核心' },
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		createdAt: 1_700_000_000_000,
		adoptedAt: null,
		history: [],
		deleted: false,
		holders: [],
		unread: { ai: false, user: false },
		...over,
	};
}

/** 一条历史。 */
function entry(at: number, action: string, actor: 'ai' | 'user', detail?: unknown): HistoryEntryLike {
	return detail === undefined ? { at, action, actor } : { at, action, actor, detail };
}

/* ══════════════════════════════════════════════════════════ */
describe('① 标题独占一行（用户 2026-11-15 第 1 条）', () => {
	const head = headOf(card(), LABELS);

	it('⭐ 标题是 head 上的**独立字段**，不在 meta 数组里', () => {
		assert.equal(head.title, '把详情面板重做');
		assert.equal(
			head.meta.some((one) => one.text === '把详情面板重做'),
			false,
		);
	});

	it('⭐ meta 四格里没有任何一格是标题，也**不含状态**（状态是独立字段）', () => {
		assert.deepEqual(
			head.meta.map((one) => one.kind),
			['id', 'kind', 'domain', 'template'],
		);
	});

	it('⭐ 标题不会被拼接进 id / kind 之类的格子（不出现 title 子串）', () => {
		for (const item of head.meta) {
			assert.equal(item.text.includes('重做'), false);
		}
	});

	it('标题原样返回 —— 不做「截断 / 加前缀」之类加工', () => {
		assert.equal(headOf(card({ title: '  两边有空格  ' }), LABELS).title, '  两边有空格  ');
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('①b 状态是**独立字段**、不在 meta 里（用户 2026-11-18）', () => {
	/*
	 * 用户原话：
	 * > 「状态需要放在最左边。可交互的东西被 label 顺位放在右边是不合理的。
	 * >  如果 label 太长，那么状态按钮的位置甚至会变化。所以他至少放在 label 的左边。
	 * >  但我希望他放在编号的左边。」
	 *
	 * 根因是「label 太长会让状态漂移」。⇒ 它必须**独立于 meta 数组**，
	 * 这样组件里只有一个地方能画它，label 再长也挤不走。
	 */
	it('⭐ head.status 是独立字段，带原始 state id 和中文名', () => {
		const head = headOf(card(), LABELS);
		assert.equal(head.status.status, S.working);
		assert.equal(head.status.text, '处理中');
	});

	it('⭐ status 不在 meta 数组里（meta 四格全是 label）', () => {
		const head = headOf(card(), LABELS);
		/*
		 * ⚠ 这里用 `String(...)` 而不是 `one.kind === 'status'` ——
		 *   后者在类型上已经被排除了（`DetailMetaItem` 没有 `status` 成员），
		 *   `tsc` 会报 TS2367「比较无意义」。
		 *   但这个断言的价值恰恰是**运行时**再确认一遍（类型可以被 `as` 绕过），
		 *   所以从宽比较。
		 */
		assert.equal(
			head.meta.some((one) => String(one.kind) === 'status'),
			false,
		);
		assert.equal(head.meta.length, 4);
	});

	it('⚠ meta 里四格的 kind 顺序固定：编号 → 类别 → 领域 → 模板', () => {
		assert.deepEqual(
			headOf(card(), LABELS).meta.map((one) => one.kind),
			['id', 'kind', 'domain', 'template'],
		);
	});

	it('⭐ 超长 kindLabel / templateLabel **不会**改变 head.status（状态和 label 无耦合）', () => {
		const long = { kindLabel: '设'.repeat(80), templateLabel: '模'.repeat(80) };
		assert.deepEqual(headOf(card(), long).status, headOf(card(), LABELS).status);
	});

	it('乱状态名不炸（颜色退回灰、名字原样）', () => {
		const head = headOf(card({ status: 'TASK_STATE_NOT_A_REAL_ONE' }), LABELS);
		assert.equal(typeof head.status.text, 'string');
		assert.equal(head.status.status, 'TASK_STATE_NOT_A_REAL_ONE');
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('② 不要「正文」这种容器标签（用户 2026-11-15 第 2 条）', () => {
	const table = detailTableOf(
		card({
			sections: {
				goal: { label: '目标', payload: { $type: 'text', value: '把详情做对' } },
			},
		}),
		LABELS,
	);

	it('⭐ 整张表里没有任何叫「正文」的标签', () => {
		const texts: string[] = [];
		for (const one of table.head.meta) texts.push(one.text);
		texts.push(table.head.title);
		texts.push(table.note.label);
		texts.push(table.history.label);
		for (const one of table.sections) {
			texts.push(one.label);
			texts.push(one.text);
		}
		assert.equal(
			texts.some((one) => one.includes('正文')),
			false,
			`不该出现「正文」二字，实际：${JSON.stringify(texts)}`,
		);
	});

	it('⭐ 字段名里也没有 body / content 这种总容器（结构上没有容器层）', () => {
		assert.deepEqual(Object.keys(table).sort(), ['head', 'history', 'note', 'sections']);
	});

	it('⭐ 章节直接平铺成一个数组，名下没有第二层分组', () => {
		assert.ok(Array.isArray(table.sections));
		assert.equal(table.sections.length, 1);
		assert.equal(table.sections[0]?.label, '目标');
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('③ 备注常驻（用户 2026-11-15 第 3 条）', () => {
	it('⭐ 备注为空也 visible（不是「有才显示」）', () => {
		assert.equal(noteOf(card({ note: '' })).visible, true);
	});

	it('⭐ 备注有内容也 visible', () => {
		assert.equal(noteOf(card({ note: '等对方确认' })).visible, true);
	});

	it('⭐ 已删除的卡：备注**仍然显示**，只是不可编辑', () => {
		const note = noteOf(card({ deleted: true, note: '旧备注' }));
		assert.equal(note.visible, true);
		assert.equal(note.editable, false);
		assert.equal(note.value, '旧备注');
	});

	it('备注文案照旧版（label + placeholder 一字未改）', () => {
		const note = noteOf(card());
		assert.equal(note.label, '备注 / 搁置理由（随时写）');
		assert.notEqual(note.placeholder, '');
	});

	it('未删除的卡可编辑', () => {
		assert.equal(noteOf(card()).editable, true);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('④ 章节：顺序 = 键插入顺序，不排序', () => {
	it('⭐ 顺序跟着 Object 键顺序（= 模板作者写的顺序），不是拼音序', () => {
		const sections = sectionsOf({
			zebra: { label: '末尾', payload: 'z' },
			alpha: { label: '开头', payload: 'a' },
		});
		assert.deepEqual(
			sections.map((one) => one.id),
			['zebra', 'alpha'],
		);
	});

	it('⭐ payload 原样透传给 C6 的 Section（同一个引用，不复制、不改写）', () => {
		const payload = { $type: 'text', value: 'hello' };
		const sections = sectionsOf({ goal: { label: '目标', payload } });
		assert.strictEqual(sections[0]?.payload, payload);
	});

	it('payload 是 text ⇒ 抽出人话兜底', () => {
		const sections = sectionsOf({ goal: { label: '目标', payload: { value: '第一段' } } });
		assert.equal(sections[0]?.text, '第一段');
		assert.equal(sections[0]?.empty, false);
	});

	it('空 payload ⇒ empty = true（组件画占位，不画空框）', () => {
		const sections = sectionsOf({ goal: { label: '目标', payload: null } });
		assert.equal(sections[0]?.empty, true);
	});

	it('⭐ 只有空白的 payload 也算空（trim 过）', () => {
		const sections = sectionsOf({ goal: { label: '目标', payload: '  \n\t' } });
		assert.equal(sections[0]?.empty, true);
	});

	it('没有章节 ⇒ 空数组（不是 null，组件 map 就完事）', () => {
		assert.deepEqual(sectionsOf({}), []);
	});

	it('章节名用卡上的**副本**（不查模板）', () => {
		const sections = sectionsOf({ x: { label: '模板卸载后也要在', payload: '' } });
		assert.equal(sections[0]?.label, '模板卸载后也要在');
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('⑤ 动作行：关系显眼（用户 2026-11-15 第 2 条）', () => {
	it('⭐ 关系按钮是 primary（显眼），派生子任务是 normal', () => {
		const actions = actionsOf(card());
		const rel = actions.find((one) => one.kind === 'relations');
		const derive = actions.find((one) => one.kind === 'derive');
		assert.equal(rel?.emphasis, 'primary');
		assert.equal(derive?.emphasis, 'normal');
	});

	it('⭐ 只有两个按钮，顺序是 关系 → 派生子任务', () => {
		assert.deepEqual(
			actionsOf(card()).map((one) => one.kind),
			['relations', 'derive'],
		);
	});

	it('关系 0 条时按钮**仍然显示**（用户不知道能加才是真问题）', () => {
		const rel = actionsOf(card()).find((one) => one.kind === 'relations');
		assert.equal(rel?.badge, 0);
		assert.match(rel?.title ?? '', /还没有任何关系/);
	});

	it('关系数 = 父任务 1 + links 条数', () => {
		assert.equal(
			relationCountOf(
				card({
					relations: {
						parent: 'DE-01',
						links: [
							{ label: 'blocks', to: 'DE-04' },
							{ label: 'relates', to: 'DE-05' },
						],
					},
				}),
			),
			3,
		);
	});

	it('没有父任务时不算 1 条', () => {
		assert.equal(relationCountOf(card()), 0);
	});

	it('计数落在关系按钮的 badge 上', () => {
		const rel = actionsOf(
			card({ relations: { parent: 'DE-01', links: [] } }),
		).find((one) => one.kind === 'relations');
		assert.equal(rel?.badge, 1);
	});

	it('墓碑 ⇒ 两个动作按钮都禁用', () => {
		assert.deepEqual(
			actionsOf(card({ deleted: true })).map((one) => one.disabled),
			[true, true],
		);
	});

	it('墓碑横幅有文案；正常卡没有', () => {
		assert.notEqual(headOf(card({ deleted: true }), LABELS).banner, null);
		assert.equal(headOf(card(), LABELS).banner, null);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('⑥ 历史：空不显示，有就**全画**（不折叠，用户 2026-11-18）', () => {
	/*
	 * 用户原话：
	 * > 「历史不需要折叠。没有折叠的含义。他是一个竖直显示。但是历史自己就是最后了。
	 * >  他的折叠并不影响看他后面的内容。他没有更后面了。」
	 *
	 * ⇒ `DetailHistoryView` 里**没有** collapsible / collapsed 两个字段。
	 *   这组测试钉住「不该有的字段不存在」—— 用 `in` 检查，加回来就红。
	 */
	it('⭐ 空历史 ⇒ visible = false（不画空框）', () => {
		const view = historyTableOf([]);
		assert.equal(view.visible, false);
		assert.equal(view.count, 0);
		assert.deepEqual(view.items, []);
	});

	it('⭐ 1 条 ⇒ visible = true，items 全部在', () => {
		const view = historyTableOf([entry(1, 'create', 'user')]);
		assert.equal(view.visible, true);
		assert.equal(view.items.length, 1);
	});

	it('⭐ 3 条 ⇒ 3 条**全部**在 items 里（没有「只画前 N 条」）', () => {
		const view = historyTableOf([
			entry(1, 'create', 'user'),
			entry(2, 'transition', 'ai'),
			entry(3, 'update', 'user'),
		]);
		assert.equal(view.visible, true);
		assert.equal(view.count, 3);
		assert.equal(view.items.length, 3);
	});

	it('⭐ 20 条也不截断（真的是一条都不藏）', () => {
		const many = Array.from({ length: 20 }, (_, i) => entry(i + 1, 'update', 'user'));
		assert.equal(historyTableOf(many).items.length, 20);
	});

	it('⭐ 视图里**没有** collapsible / collapsed 字段（折叠概念被删掉了，不是默认关）', () => {
		const view = historyTableOf([entry(1, 'create', 'user'), entry(2, 'update', 'ai')]);
		assert.equal('collapsible' in view, false);
		assert.equal('collapsed' in view, false);
	});

	it('表头带计数（旧版「历史（N）」）', () => {
		assert.equal(historyTableOf([entry(1, 'create', 'user')]).label, '历史（1）');
		assert.equal(
			historyTableOf([entry(1, 'create', 'user'), entry(2, 'update', 'ai')]).label,
			'历史（2）',
		);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('⑦ 历史：最新在上，同毫秒保持原顺序', () => {
	it('⭐ 按 at 倒序（物流轨迹读法）', () => {
		const view = historyTableOf([
			entry(100, 'create', 'user'),
			entry(300, 'transition', 'ai'),
			entry(200, 'update', 'user'),
		]);
		assert.deepEqual(
			view.items.map((one) => one.at),
			[300, 200, 100],
		);
	});

	it('⭐ 同毫秒的两条保持写入顺序（sort 稳定性依赖，钉住不靠「应该」）', () => {
		const view = historyTableOf([
			entry(500, 'create', 'user'),
			entry(500, 'adopt', 'ai'),
			entry(500, 'claim', 'user'),
		]);
		assert.deepEqual(
			view.items.map((one) => one.action),
			['create', 'adopt', 'claim'],
		);
	});

	it('⭐ key 在同毫秒时也不重复（React key 用）', () => {
		const view = historyTableOf([entry(500, 'a', 'user'), entry(500, 'b', 'user')]);
		const keys = view.items.map((one) => one.key);
		assert.equal(new Set(keys).size, keys.length);
	});

	it('脏数据（at 不是数字）不抛，且排在最后', () => {
		const dirty = { at: Number.NaN, action: 'create', actor: 'user' } as unknown as HistoryEntryLike;
		const view = historyTableOf([entry(100, 'create', 'user'), dirty]);
		assert.deepEqual(
			view.items.map((one) => one.at),
			[100, 0],
		);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('⑧ 历史条目 → 人话（actor 读顶层字段，不从 action 反推）', () => {
	const text = (one: HistoryEntryLike): string => historyTableOf([one]).items[0]?.text ?? '';

	it('create：AI / 用户 分开说', () => {
		assert.equal(text(entry(1, 'create', 'ai')), 'AI 创建了这张卡');
		assert.equal(text(entry(1, 'create', 'user')), '用户 创建了这张卡');
	});

	it('create 且 origin=derive ⇒ 「派生出这张卡」（不重复说作者）', () => {
		assert.equal(text(entry(1, 'create', 'ai', { origin: 'derive' })), '派生出这张卡');
	});

	it('transition：两头的状态都翻成中文', () => {
		assert.equal(
			text(entry(1, 'transition', 'user', { from: S.draft, to: S.working })),
			'用户 把状态从「未指定」改成「处理中」',
		);
	});

	it('⭐ actor 是顶层字段时，detail 里写什么都**不**影响作者', () => {
		const withWrongPrincipal = entry(1, 'claim', 'user', { principal: 'agentMessageLoop1' });
		assert.equal(text(withWrongPrincipal), '用户 领取了这张卡');
	});

	it('claim / release / adopt 三句', () => {
		assert.equal(text(entry(1, 'claim', 'ai')), 'AI 领取了这张卡');
		assert.equal(text(entry(1, 'release', 'user')), '用户 释放了这张卡');
		assert.equal(text(entry(1, 'adopt', 'user')), '用户 采纳了这张卡');
	});

	it('recompute 说「系统按子任务重算」（不显示裸 action 名）', () => {
		assert.equal(
			text(entry(1, 'recompute', 'ai', { from: S.working, to: S.completed })),
			'系统按子任务重算：状态从「处理中」变成「成功」',
		);
	});

	it('supersede / fork 带上目标 id', () => {
		assert.equal(text(entry(1, 'supersede', 'user', { superseded: 'DE-09' })), '用户 用这张卡取代了 DE-09');
		assert.equal(text(entry(1, 'fork', 'user', { childId: 'DE-10' })), '派生子任务 DE-10');
	});

	it('⭐ 不认识的 action 原样显示（不编中文）', () => {
		assert.equal(text(entry(1, 'brand-new-action', 'user')), 'brand-new-action');
	});

	it('没有 actor 的老数据 ⇒ 说「系统」，不假装是用户', () => {
		const legacy = { at: 1, action: 'create' } as HistoryEntryLike;
		assert.equal(text(legacy), '系统 创建了这张卡');
	});

	it('detail 缺字段 ⇒ 状态位显示「—」，不抛、不显示 undefined', () => {
		const textOne = text(entry(1, 'transition', 'user', {}));
		assert.equal(textOne.includes('undefined'), false);
		assert.equal(textOne, '用户 把状态从「—」改成「—」');
	});

	it('detail 不是对象（脏数据）也不抛', () => {
		assert.equal(text(entry(1, 'transition', 'user', 'oops')), '用户 把状态从「—」改成「—」');
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('⑨ 整张表：detailTableOf 只是四块的组装', () => {
	const full = card({
		note: '等确认',
		sections: { goal: { label: '目标', payload: { value: '把详情做对' } } },
		relations: { parent: 'DE-01', links: [{ label: 'blocks', to: 'DE-02' }] },
		history: [entry(1, 'create', 'user'), entry(2, 'transition', 'ai', { from: S.submitted, to: S.working })],
	});
	const table = detailTableOf(full, LABELS);

	it('四块都在，形状对', () => {
		assert.equal(table.head.title, full.title);
		assert.equal(table.sections.length, 1);
		assert.equal(table.note.visible, true);
		assert.equal(table.history.count, 2);
	});

	it('⭐ 备注常驻 + 历史全画，同一次调用里同时成立', () => {
		assert.equal(table.note.visible, true);
		assert.equal(table.history.visible, true);
		assert.equal(table.history.items.length, 2);
	});

	it('状态名是中文（不是协议全名），且在 head.status 上', () => {
		assert.equal(table.head.status.text, '处理中');
		assert.equal(table.head.status.status, S.working);
	});

	it('meta 的编号格带分类色系（design）', () => {
		const id = table.head.meta.find((one) => one.kind === 'id');
		assert.equal(id?.kind === 'id' ? id.tone : '', 'design');
	});

	it('未知分类的色系回落 record（与 card-view 的 kindTone 一致）', () => {
		const head = headOf(card({ template: { ref: 'x', kind: 'unknown-kind', domain: '核心' } }), LABELS);
		const id = head.meta.find((one) => one.kind === 'id');
		assert.equal(id?.kind === 'id' ? id.tone : '', 'record');
	});

	it('模板徽章的 title 带「模板：」前缀（旧版行为）', () => {
		const item = table.head.meta.find((one) => one.kind === 'template');
		assert.equal(item?.kind === 'template' ? item.title : '', '模板：功能设计');
	});
});
